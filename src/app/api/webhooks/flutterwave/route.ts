import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { createSubscriptionService } from "@/lib/payments/subscription-service";
import { flutterwaveProvider } from "@/lib/payments/flutterwave/provider";
import {
  recordPaymentLog,
  PAYMENT_LOG_TYPE,
  PAYMENT_LOG_SOURCE,
} from "@/lib/payments/payment-log";

export const runtime = "nodejs";

function webhookHash(): string {
  const hash = process.env.FLW_WEBHOOK_HASH?.trim();
  if (!hash || hash.includes("change-me")) {
    throw new Error("FLW_WEBHOOK_HASH is not configured.");
  }
  return hash;
}

function signatureMatches(rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", webhookHash()).update(rawBody).digest("base64");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("flutterwave-signature");
  const signatureValid = signatureMatches(rawBody, signature);

  if (!signatureValid) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: {
    id?: string;
    type?: string;
    data?: { id?: string; tx_ref?: string; status?: string; amount?: number };
  };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (payload.type === "charge.completed" || payload.data?.status !== undefined) {
    const txRef = payload.data?.tx_ref?.trim();
    const transactionId = payload.data?.id?.trim();

    if (txRef) {
      const session = await prisma.checkoutSession.findUnique({ where: { txRef } });

      await recordPaymentLog({
        userId: session?.userId ?? "system",
        checkoutSessionId: session?.id,
        type: PAYMENT_LOG_TYPE.WEBHOOK_RECEIVED,
        source: PAYMENT_LOG_SOURCE.WEBHOOK,
        plan: session?.plan,
        amount: session?.amount,  // kobo
        currency: session ? "NGN" : undefined,
        txRef,
        providerTransactionId: transactionId,
        rawPayload: {
          webhookId: payload.id ?? null,
          eventType: payload.type ?? null,
          body: payload,
        },
        verificationStatus: "UNVERIFIED",
        message: "Webhook received with a valid signature.",
      });

      if (session && session.status !== "COMPLETED") {
        // Re-verify with Flutterwave's API before trusting the payload.
        try {
          const service = createSubscriptionService(flutterwaveProvider);
          await service.finalizeFromWebhook(session.userId, txRef, transactionId);
        } catch {
          // Acknowledge the event; the return-flow polling path will retry.
        }
      }
    }
  }

  return new Response("OK", { status: 200 });
}
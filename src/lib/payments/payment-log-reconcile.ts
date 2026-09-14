import { prisma } from "@/lib/db/prisma";
import { createSubscriptionService } from "@/lib/payments/subscription-service";
import { flutterwaveProvider } from "@/lib/payments/flutterwave/provider";

/**
 * Replay the payment log for a checkout session and summarise what the
 * trusted log says happened, independent of the current row state.
 */
export async function replayCheckoutLog(txRef: string) {
  const logs = await prisma.paymentLog.findMany({
    where: { txRef },
    orderBy: { createdAt: "asc" },
    select: {
      type: true,
      source: true,
      verificationStatus: true,
      plan: true,
      amount: true,
      currency: true,
      providerTransactionId: true,
      providerSubscriptionId: true,
      message: true,
      createdAt: true,
    },
  });

  return {
    txRef,
    verifiedSucceeded:
      logs.some((l) => l.type === "VERIFY_COMPLETED" && l.verificationStatus === "SUCCESSFUL"),
    stateChanged:
      logs.some((l) => l.type === "STATE_CHANGED" && l.verificationStatus === "SUCCESSFUL"),
    errors: logs.filter((l) => l.type === "ERROR").length,
    entries: logs.length,
    lastEntry: logs.at(-1) ?? null,
  };
}

/**
 * Backstop reconciliation. For every checkout session that is still PENDING,
 * re-verify it with the provider through the same verified path used by the
 * return and webhook flows (idempotent, and it writes to the payment log).
 *
 * Sessions already COMPLETED are skipped — the log + session state agree by
 * construction because completion is only ever written after a verified
 * payment.
 */
export async function reconcilePendingPayments(): Promise<{
  rechecked: number;
  completed: number;
}> {
  const service = createSubscriptionService(flutterwaveProvider);

  const pending = await prisma.checkoutSession.findMany({
    where: { status: "PENDING" },
    select: { id: true, userId: true, txRef: true },
    orderBy: { createdAt: "asc" },
  });

  let completed = 0;
  for (const session of pending) {
    const result = await service.finalizeFromWebhook(session.userId, session.txRef);
    if (result.status === "COMPLETED" || result.status === "ALREADY_COMPLETED") {
      completed += 1;
    }
  }

  return { rechecked: pending.length, completed };
}
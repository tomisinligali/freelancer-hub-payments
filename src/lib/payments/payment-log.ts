import type { Plan } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { PaymentLogStatus } from "@prisma/client";
import type { ScopedPrisma } from "@/lib/db/scoped";
import { enforcementPrisma } from "@/lib/db/prisma";

/**
 * Payment log kinds. Each entry is a single immutable payment fact.
 */
export const PAYMENT_LOG_TYPE = {
  CHECKOUT_INITIATED: "CHECKOUT_INITIATED",
  PROVIDER_RETURN: "PROVIDER_RETURN",
  WEBHOOK_RECEIVED: "WEBHOOK_RECEIVED",
  VERIFY_REQUESTED: "VERIFY_REQUESTED",
  VERIFY_COMPLETED: "VERIFY_COMPLETED",
  STATE_CHANGED: "STATE_CHANGED",
  ERROR: "ERROR",
} as const;

export type PaymentLogType = (typeof PAYMENT_LOG_TYPE)[keyof typeof PAYMENT_LOG_TYPE];

export const PAYMENT_LOG_SOURCE = {
  RETURN_PAGE: "RETURN_PAGE",
  WEBHOOK: "WEBHOOK",
  SYSTEM: "SYSTEM",
} as const;

export type PaymentLogSource = (typeof PAYMENT_LOG_SOURCE)[keyof typeof PAYMENT_LOG_SOURCE];

/**
 * Strip anything that might carry credentials or secrets before persisting.
 * Flutterwave payloads include ids/amounts/status but never API keys; this
 * guard drops any object hole named like a secret as a belt-and-braces measure.
 */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/secret|key|token|password|authorization|signature|hash/i.test(key)) continue;
      out[key] = redact(entry);
    }
    return out;
  }
  return value;
}

export interface PaymentLogInput {
  userId: string;
  checkoutSessionId?: string;
  type: PaymentLogType;
  source: PaymentLogSource;
  plan?: Plan;
  amount?: number;  // minor units (kobo)
  currency?: string;
  txRef?: string;
  providerTransactionId?: string;
  providerSubscriptionId?: string;
  verificationStatus?: PaymentLogStatus;
  rawPayload?: unknown;
  verificationResult?: unknown;
  message?: string;
}

function toInput(input: PaymentLogInput) {
  return {
    userId: input.userId,
    checkoutSessionId: input.checkoutSessionId ?? null,
    type: input.type,
    source: input.source,
    plan: input.plan ?? null,
    amount: input.amount ?? null,
    currency: input.currency ?? null,
    txRef: input.txRef ?? null,
    providerTransactionId: input.providerTransactionId ?? null,
    providerSubscriptionId: input.providerSubscriptionId ?? null,
    verificationStatus: input.verificationStatus ?? "UNVERIFIED",
    rawPayload:
      input.rawPayload !== undefined
        ? (redact(input.rawPayload) as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    verificationResult:
      input.verificationResult !== undefined
        ? (redact(input.verificationResult) as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    message: input.message ?? null,
  };
}

/**
 * Append a payment log entry. The log is write-only by construction:
 * updates and deletes are rejected by the Prisma extension in prisma.ts.
 *
 * The public surface accepts a client so both the per-user scoped flow
 * (return page) and the system flow (webhook) write the same shape.
 */
export async function recordPaymentLog(
  input: PaymentLogInput,
  db: ScopedPrisma | typeof enforcementPrisma = enforcementPrisma,
): Promise<void> {
  await db.paymentLog.create({ data: toInput(input) });
}
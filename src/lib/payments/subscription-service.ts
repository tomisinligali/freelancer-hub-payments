import { randomUUID } from "crypto";
import type { Plan, SubscriptionStatus } from "@prisma/client";
import { getScopedPrisma } from "@/lib/db/scoped";
import { planMonths, getPlan, YEARLY_PRICE_KOBO } from "@/lib/payments/plans";
import { addMonths, proratedUpgradeCharge, remainingPeriodFraction } from "@/lib/payments/billing-math";
import { NGN, formatMoney } from "@/lib/payments/types";
import type { PaymentProvider } from "@/lib/payments/types";
import {
  recordPaymentLog,
  PAYMENT_LOG_TYPE,
  PAYMENT_LOG_SOURCE,
} from "@/lib/payments/payment-log";

export const EVENT = {
  CHECKOUT_STARTED: "CHECKOUT_STARTED",
  PAYMENT_VERIFIED: "PAYMENT_VERIFIED",
  UPGRADE_PAID: "UPGRADE_PAID",
  DOWNGRADE_SCHEDULED: "DOWNGRADE_SCHEDULED",
  DOWNGRADE_APPLIED: "DOWNGRADE_APPLIED",
  CANCELLED: "CANCELLED",
  CANCELLED_AT_PERIOD_END: "CANCELLED_AT_PERIOD_END",
  PERIOD_ENDED: "PERIOD_ENDED",
  RESUBSCRIBE_SCHEDULED: "RESUBSCRIBE_SCHEDULED",
  RESUBSCRIBE_PAYMENT_STARTED: "RESUBSCRIBE_PAYMENT_STARTED",
  RESUBSCRIBE_APPLIED: "RESUBSCRIBE_APPLIED",
} as const;

export type EventType = (typeof EVENT)[keyof typeof EVENT];

export interface SubscriptionView {
  plan: Plan;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  pendingDowngradeTo: Plan | null;
  pendingResubscribeTo: Plan | null;
  pendingResubscribeCheckoutUrl: string | null;
  providerSubscriptionId: string | null;
  hasPaidPlan: boolean;
  canUpgrade: boolean;
  canDowngrade: boolean;
  canSubscribe: boolean;
  canCancel: boolean;
  proratedUpgradeCharge: number | null;  // minor units (kobo)
}

export interface CheckoutResult {
  checkoutSessionId: string;
  checkoutUrl: string;
  amount: number;  // minor units (kobo)
  plan: Plan;
  intent: string;
  txRef: string;
}

export interface ReturnResult {
  ok: boolean;
  message: string;
  plan: Plan;
  status?: "COMPLETED" | "FAILED" | "PENDING" | "ALREADY_COMPLETED" | "NOT_FOUND";
}

export class SubscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscriptionError";
  }
}

function buildView(
  sub: {
    plan: Plan;
    status: SubscriptionStatus;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    pendingDowngradeTo: Plan | null;
    pendingResubscribeTo: Plan | null;
    providerSubscriptionId: string | null;
  } | null,
  pendingResubscribeCheckoutUrl: string | null = null,
): SubscriptionView {
  const now = new Date();
  const plan: Plan = sub?.plan ?? "FREE";

  const proratedCharge =
    plan === "MONTHLY" && sub?.currentPeriodStart && sub?.currentPeriodEnd
      ? proratedUpgradeCharge(now, sub.currentPeriodStart, sub.currentPeriodEnd)
      : null;

  return {
    plan,
    status: sub?.status ?? "ACTIVE",
    currentPeriodStart: sub?.currentPeriodStart ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    pendingDowngradeTo: sub?.pendingDowngradeTo ?? null,
    pendingResubscribeTo: sub?.pendingResubscribeTo ?? null,
    pendingResubscribeCheckoutUrl,
    providerSubscriptionId: sub?.providerSubscriptionId ?? null,
    hasPaidPlan: plan === "MONTHLY" || plan === "YEARLY",
    canUpgrade: plan === "MONTHLY",
    canDowngrade: plan === "YEARLY",
    canSubscribe: plan === "FREE",
    canCancel: plan === "MONTHLY" || plan === "YEARLY",
    proratedUpgradeCharge: proratedCharge,
  };
}

export function createSubscriptionService(provider: PaymentProvider) {
  function getDb(userId: string) {
    return getScopedPrisma(userId);
  }

  async function loadUserSubscription(userId: string) {
    const db = getDb(userId);
    return db.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });
  }

  async function recordEvent(
    db: ReturnType<typeof getDb>,
    userId: string,
    input: {
      type: EventType;
      plan: Plan;
      amount?: number;  // minor units (kobo)
      providerReference?: string | null;
      providerSubscriptionId?: string | null;
      subscriptionId?: string | null;
      checkoutSessionId?: string | null;
      details?: Record<string, unknown>;
    },
  ) {
    await db.subscriptionEvent.create({
      data: {
        userId,
        subscriptionId: input.subscriptionId ?? null,
        type: input.type,
        plan: input.plan,
        amount: input.amount ?? 0,
        currency: NGN,
        providerReference: input.providerReference ?? null,
        providerSubscriptionId: input.providerSubscriptionId ?? null,
        checkoutSessionId: input.checkoutSessionId ?? null,
        details: input.details ? JSON.stringify(input.details) : null,
      },
    });
  }

  /** Idempotently create the checkout session used to pay for a scheduled resubscribe. */
  async function ensureResubscribePayment(
    db: ReturnType<typeof getDb>,
    user: { email: string | null; fullName: string | null; firstName: string | null },
    sub: { id: string; userId: string; pendingResubscribeTo: string | null; pendingResubscribeCheckoutId: string | null; currentPeriodEnd: Date | null; providerSubscriptionId: string | null },
  ): Promise<string> {
    const target = sub.pendingResubscribeTo as Plan;

    // If a checkout already exists and hasn't failed, return its URL.
    if (sub.pendingResubscribeCheckoutId) {
      const existing = await db.checkoutSession.findUnique({ where: { id: sub.pendingResubscribeCheckoutId } });
      if (existing && existing.status !== "FAILED" && existing.providerCheckoutUrl) {
        return existing.providerCheckoutUrl;
      }
    }

    const amount = getPlan(target).price;
    const { providerPlanIdFor } = await import("@/lib/payments/flutterwave/provider");
    const providerPlanId = providerPlanIdFor(target);
    const txRef = `fh_${randomUUID()}`;
    const redirectUrl = `${process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? ""}/return`;

    const checkoutUrl = await provider.createCheckout({
      txRef,
      amount,
      currency: NGN,
      plan: target,
      email: user.email ?? "",
      customerName: user.fullName ?? user.firstName ?? user.email ?? "",
      redirectUrl,
      providerPlanId,
    });

    const session = await db.checkoutSession.create({
      data: {
        userId: sub.userId,
        txRef,
        intent: "RESUBSCRIBE",
        plan: target,
        amount,
        status: "PENDING",
        providerCheckoutUrl: checkoutUrl,
      },
    });

    await db.subscription.update({
      where: { userId: sub.userId },
      data: { pendingResubscribeCheckoutId: session.id, status: "PAST_DUE" },
    });

    await recordPaymentLog(
      {
        userId: sub.userId,
        checkoutSessionId: session.id,
        type: PAYMENT_LOG_TYPE.CHECKOUT_INITIATED,
        source: PAYMENT_LOG_SOURCE.SYSTEM,
        plan: target,
        amount: amount,
        currency: NGN,
        txRef,
        providerSubscriptionId: providerPlanId,
        rawPayload: { intent: "RESUBSCRIBE", checkoutUrl, redirectUrl },
      },
      db,
    );

    await recordEvent(db, sub.userId, {
      type: EVENT.RESUBSCRIBE_PAYMENT_STARTED,
      plan: target,
      amount,
      checkoutSessionId: session.id,
      subscriptionId: sub.id,
      details: { appliesAt: sub.currentPeriodEnd?.toISOString() ?? null },
    });

    return checkoutUrl;
  }

  /**
   * Apply any period-end changes that are due (downgrade or cancellation).
   * Idempotent and safe to run on every read.
   */
  async function reconcile(userId: string): Promise<void> {
    const db = getDb(userId);
    const user = await loadUserSubscription(userId);
    if (!user?.subscription) return;

    const sub = user.subscription;
    const now = new Date();
    if (!sub.currentPeriodEnd || sub.currentPeriodEnd > now) return;

    const periodEnd = sub.currentPeriodEnd;

    if (sub.cancelAtPeriodEnd) {
      if (sub.pendingResubscribeTo) {
        // Initiate the payment for the scheduled new plan (idempotent).
        if (!sub.pendingResubscribeCheckoutId) {
          try {
            await ensureResubscribePayment(db, user, sub);
          } catch (e) {
            await recordPaymentLog(
              {
                userId,
                type: PAYMENT_LOG_TYPE.ERROR,
                source: PAYMENT_LOG_SOURCE.SYSTEM,
                plan: sub.pendingResubscribeTo as Plan,
                message:
                  e instanceof Error
                    ? e.message
                    : "Could not start the payment for the scheduled subscription.",
              },
              db,
            );
          }
        }
        return;
      }

      await db.$transaction([
        db.user.update({ where: { id: userId }, data: { plan: "FREE" } }),
        db.subscription.update({
          where: { userId },
          data: {
            plan: "FREE",
            cancelAtPeriodEnd: false,
            pendingDowngradeTo: null,
            pendingResubscribeTo: null,
            pendingResubscribeCheckoutId: null,
            currentPeriodStart: null,
            currentPeriodEnd: null,
          },
        }),
      ]);
      await recordEvent(db, userId, {
        type: EVENT.CANCELLED_AT_PERIOD_END,
        plan: "FREE",
        providerSubscriptionId: sub.providerSubscriptionId,
        subscriptionId: sub.id,
        details: { appliedAt: periodEnd.toISOString() },
      });
      return;
    }

    if (sub.pendingDowngradeTo) {
      const target = sub.pendingDowngradeTo as Plan;
      const months = planMonths(target) ?? 1;
      const newStart = periodEnd;
      const newEnd = addMonths(newStart, months);
      await db.$transaction([
        db.user.update({ where: { id: userId }, data: { plan: target } }),
        db.subscription.update({
          where: { userId },
          data: {
            plan: target,
            pendingDowngradeTo: null,
            status: "ACTIVE",
            currentPeriodStart: newStart,
            currentPeriodEnd: newEnd,
          },
        }),
      ]);
      await recordEvent(db, userId, {
        type: EVENT.DOWNGRADE_APPLIED,
        plan: target,
        providerSubscriptionId: sub.providerSubscriptionId,
        subscriptionId: sub.id,
        details: { appliedAt: periodEnd.toISOString() },
      });
      return;
    }

    // Un-scheduled paid period ended -> roll the period forward (test-mode
    // renewal; real-money renewals are charged by the provider's webhook,
    // which is out of scope for this slice).
    const months = planMonths(sub.plan) ?? 1;
    const newStart = periodEnd;
    const newEnd = addMonths(newStart, months);
    await db.$transaction([
      db.subscription.update({
        where: { userId },
        data: { status: "ACTIVE", currentPeriodStart: newStart, currentPeriodEnd: newEnd },
      }),
    ]);
    await recordEvent(db, userId, {
      type: EVENT.PERIOD_ENDED,
      plan: sub.plan,
      providerSubscriptionId: sub.providerSubscriptionId,
      subscriptionId: sub.id,
      details: { periodEnd, newPeriodEnd: newEnd.toISOString() },
    });
  }

  async function getView(userId: string): Promise<SubscriptionView> {
    await reconcile(userId);
    const user = await loadUserSubscription(userId);
    const sub = user?.subscription ?? null;

    let pendingResubscribeCheckoutUrl: string | null = null;
    if (sub?.pendingResubscribeCheckoutId) {
      const checkout = await getDb(userId).checkoutSession.findUnique({
        where: { id: sub.pendingResubscribeCheckoutId },
      });
      pendingResubscribeCheckoutUrl =
        checkout && checkout.status !== "FAILED" ? checkout.providerCheckoutUrl : null;
    }

    return buildView(sub, pendingResubscribeCheckoutUrl);
  }

  async function initiateCheckout(
    userId: string,
    intent: "SUBSCRIBE" | "UPGRADE",
    requestedPlan: Plan,
    email: string,
  ): Promise<CheckoutResult> {
    if (requestedPlan !== "MONTHLY" && requestedPlan !== "YEARLY") {
      throw new SubscriptionError("Only the monthly and yearly plans can be purchased.");
    }

    await reconcile(userId);
    const db = getDb(userId);

    // Rate limiting: max 5 checkout initiations per 15 minutes per user.
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const recentCheckouts = await db.checkoutSession.count({
      where: { userId, createdAt: { gte: fifteenMinutesAgo } },
    });
    if (recentCheckouts >= 5) {
      await recordPaymentLog(
        {
          userId,
          type: PAYMENT_LOG_TYPE.ERROR,
          source: PAYMENT_LOG_SOURCE.SYSTEM,
          plan: requestedPlan,
          message: "Rate limited: too many checkout initiations.",
        },
        db,
      );
      throw new SubscriptionError("Too many checkout attempts. Please try again later.");
    }

    const user = await loadUserSubscription(userId);
    const sub = user?.subscription ?? null;

    let amount: number;  // minor units (kobo)
    let providerPlanId: string | undefined;
    let planForCheckout: Plan = requestedPlan;

    if (intent === "UPGRADE") {
      if (sub?.plan !== "MONTHLY") {
        throw new SubscriptionError("Upgrade is only available from the monthly plan.");
      }
      if (!sub.currentPeriodStart || !sub.currentPeriodEnd) {
        throw new SubscriptionError("Your current billing period is not active yet.");
      }
      const fraction = remainingPeriodFraction(new Date(), sub.currentPeriodStart, sub.currentPeriodEnd);
      if (fraction < 0.05) {
        throw new SubscriptionError(
          `Your current monthly period ends ${sub.currentPeriodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric" })}. Upgrading now charges near the full yearly price (${formatMoney(YEARLY_PRICE_KOBO)}) for a fresh 12 months. Wait until your next billing cycle starts, or proceed and pay the full amount today.`,
        );
      }
      amount = proratedUpgradeCharge(new Date(), sub.currentPeriodStart, sub.currentPeriodEnd);
      planForCheckout = "YEARLY";
    } else {
      const current = sub?.plan ?? "FREE";
      if (current !== "FREE") {
        if (sub?.cancelAtPeriodEnd) {
          throw new SubscriptionError(
            "Your current plan is ending and is already scheduled. Re-subscribes are confirmed on the plans page and start after your current plan ends — they are not charged immediately.",
          );
        }
        const alreadyOn = current === requestedPlan;
        if (alreadyOn) {
          throw new SubscriptionError(`You are already on the ${current.toLowerCase()} plan.`);
        }
        if (current === "MONTHLY" && requestedPlan === "YEARLY") {
          throw new SubscriptionError("To switch to the yearly plan immediately, use the Upgrade option on the plans page.");
        }
        if (current === "YEARLY" && requestedPlan === "MONTHLY") {
          throw new SubscriptionError("To switch to the monthly plan, use the Downgrade option on the plans page.");
        }
        throw new SubscriptionError(`You are already on the ${current.toLowerCase()} plan.`);
      }
      amount = getPlan(requestedPlan).price;
      providerPlanId = (await import("@/lib/payments/flutterwave/provider")).providerPlanIdFor(requestedPlan);
    }

    const txRef = `fh_${randomUUID()}`;
    const redirectUrl = `${process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? ""}/return`;

    const checkoutUrl = await provider.createCheckout({
      txRef,
      amount,
      currency: NGN,
      plan: planForCheckout,
      email,
      customerName: user?.fullName ?? user?.firstName ?? email,
      redirectUrl,
      providerPlanId,
    });

    const session = await db.checkoutSession.create({
      data: {
        userId,
        txRef,
        intent,
        plan: planForCheckout,
        amount,
        status: "PENDING",
        providerCheckoutUrl: checkoutUrl,
      },
    });

    await recordEvent(db, userId, {
      type: EVENT.CHECKOUT_STARTED,
      plan: planForCheckout,
      amount,
      checkoutSessionId: session.id,
      details: { intent },
    });

    await recordPaymentLog(
      {
        userId,
        checkoutSessionId: session.id,
        type: PAYMENT_LOG_TYPE.CHECKOUT_INITIATED,
        source: PAYMENT_LOG_SOURCE.SYSTEM,
        plan: planForCheckout,
        amount: amount,
        currency: NGN,
        txRef,
        providerSubscriptionId: providerPlanId,
        rawPayload: { intent, checkoutUrl, redirectUrl },
      },
      db,
    );

    return {
      checkoutSessionId: session.id,
      checkoutUrl,
      amount: amount,
      plan: planForCheckout,
      intent,
      txRef,
    };
  }

  async function resolvePayment(
    userId: string,
    txRef: string,
    transactionId: string | undefined,
    rawReturnParams: Record<string, unknown> | undefined,
    options: { finalize: boolean; source: "RETURN_PAGE" | "WEBHOOK" },
  ): Promise<ReturnResult> {
    const { source } = options;
    const db = getDb(userId);
    await reconcile(userId);
    const session = await db.checkoutSession.findUnique({ where: { txRef } });

    if (!session) {
      await recordPaymentLog(
        {
          userId,
          type: PAYMENT_LOG_TYPE.PROVIDER_RETURN,
          source,
          verificationStatus: "FAILED",
          txRef,
          rawPayload: { ...rawReturnParams, missingSession: true, txRef },
          message: "Return for an unknown checkout session.",
        },
        db,
      );
      return { ok: false, message: "We could not find this checkout session.", plan: "FREE", status: "NOT_FOUND" };
    }

    // Log the unverified claim before relying on any of it.
    await recordPaymentLog(
      {
        userId,
        checkoutSessionId: session.id,
        type: PAYMENT_LOG_TYPE.PROVIDER_RETURN,
        source,
        plan: session.plan,
        amount: session.amount,
        currency: NGN,
        txRef: session.txRef,
        rawPayload: rawReturnParams ?? {},
      },
      db,
    );

    // Idempotency: a completed session is never processed twice.
    if (session.status === "COMPLETED") {
      return {
        ok: true,
        message: "Your payment was successful and your plan is active.",
        plan: session.plan,
        status: "ALREADY_COMPLETED",
      };
    }

    // Only accept a numeric provider transaction id; never pass a raw
    // client-controlled query value into a provider request path.
    const safeTransactionId =
      transactionId && /^\d+$/.test(transactionId) ? transactionId : undefined;

    await recordPaymentLog(
      {
        userId,
        checkoutSessionId: session.id,
        type: PAYMENT_LOG_TYPE.VERIFY_REQUESTED,
        source,
        plan: session.plan,
        amount: session.amount,
        currency: NGN,
        txRef: session.txRef,
        providerTransactionId: safeTransactionId,
      },
      db,
    );

    let verified;
    try {
      verified = await provider.verifyTransaction(session.txRef, safeTransactionId);
    } catch (e) {
      await db.checkoutSession.update({ where: { id: session.id }, data: { status: "FAILED" } });
      await recordPaymentLog(
        {
          userId,
          checkoutSessionId: session.id,
          type: PAYMENT_LOG_TYPE.ERROR,
          source,
          plan: session.plan,
          amount: session.amount,
          currency: NGN,
          txRef: session.txRef,
          verificationStatus: "FAILED",
          message: e instanceof Error ? e.message : "Verification request failed.",
        },
        db,
      );
      return {
        ok: false,
        message: "Payment verification failed. Please try again or contact support.",
        plan: session.plan,
        status: "FAILED",
      };
    }

    await recordPaymentLog(
      {
        userId,
        checkoutSessionId: session.id,
        type: PAYMENT_LOG_TYPE.VERIFY_COMPLETED,
        source,
        plan: session.plan,
        amount: session.amount,
        currency: NGN,
        txRef: session.txRef,
        providerTransactionId: safeTransactionId,
        providerSubscriptionId: verified.providerSubscriptionId,
        verificationStatus:
          verified.status === "successful"
            ? "SUCCESSFUL"
            : verified.status === "pending"
              ? "PENDING"
              : "FAILED",
        verificationResult: {
          status: verified.status,
          amount: verified.amount,
          currency: verified.currency,
          providerSubscriptionId: verified.providerSubscriptionId ?? null,
        },
      },
      db,
    );

    if (verified.status === "pending") {
      return {
        ok: true,
        message: "Your payment is still being processed. Please check back shortly.",
        plan: session.plan,
        status: "PENDING",
      };
    }

    if (verified.status !== "successful") {
      await db.checkoutSession.update({ where: { id: session.id }, data: { status: "FAILED" } });
      await recordEvent(db, userId, {
        type: EVENT.CHECKOUT_STARTED,
        plan: session.plan,
        amount: session.amount,
        checkoutSessionId: session.id,
        details: { outcome: "failed", finalizer: source },
      });
      return {
        ok: false,
        message: "Your payment was not completed.",
        plan: session.plan,
        status: "FAILED",
      };
    }

    // The verified amount and currency must match what this slice charged.
    // A mismatch means the paid amount differs from the checkout we issued,
    // so the payment cannot be used to activate a plan.
    if (verified.amount !== session.amount || verified.currency !== NGN) {
      await db.checkoutSession.update({ where: { id: session.id }, data: { status: "FAILED" } });
      await recordPaymentLog(
        {
          userId,
          checkoutSessionId: session.id,
          type: PAYMENT_LOG_TYPE.ERROR,
          source,
          plan: session.plan,
          amount: session.amount,
          currency: NGN,
          txRef: session.txRef,
          providerSubscriptionId: verified.providerSubscriptionId,
          verificationStatus: "FAILED",
          verificationResult: {
            status: verified.status,
            amount: verified.amount,
            currency: verified.currency,
          },
          message: `Amount or currency mismatch: expected ${NGN} ${session.amount}, verified ${verified.currency} ${verified.amount}.`,
        },
        db,
      );
      await recordEvent(db, userId, {
        type: EVENT.CHECKOUT_STARTED,
        plan: session.plan,
        amount: session.amount,
        checkoutSessionId: session.id,
        details: { outcome: "amount-mismatch", paid: verified.amount, currency: verified.currency, finalizer: source },
      });
      return {
        ok: false,
        message: "The verified payment did not match the checkout. Contact support.",
        plan: session.plan,
        status: "FAILED",
      };
    }

    // Verification passed. Branch on finalize.
    if (!options.finalize) {
      // Return page: re-read session — webhook may have already applied.
      const reloaded = await db.checkoutSession.findUnique({ where: { txRef } });
      if (reloaded?.status === "COMPLETED") {
        return { ok: true, status: "COMPLETED", message: "Your payment was successful and your plan is active.", plan: session.plan };
      }
      return { ok: true, status: "PENDING", message: "Payment confirmed. Your plan is being activated — this can take a moment.", plan: session.plan };
    }

    // Finalize: apply the plan change.
    const now = new Date();
    const existing = (await loadUserSubscription(userId))?.subscription ?? null;

    let nextPlan: Plan = session.plan;
    let periodStart: Date;
    let periodEnd: Date | null;
    const providerSubscriptionId = verified.providerSubscriptionId ?? existing?.providerSubscriptionId ?? null;

    if (session.intent === "UPGRADE") {
      periodStart = now;
      periodEnd = addMonths(now, 12);
      nextPlan = "YEARLY";
    } else {
      const months = planMonths(session.plan) ?? 1;
      periodStart = now;
      periodEnd = addMonths(now, months);
    }

    await db.$transaction([
      db.user.update({ where: { id: userId }, data: { plan: nextPlan } }),
      db.subscription.upsert({
        where: { userId },
        create: {
          userId,
          plan: nextPlan,
          status: "ACTIVE",
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          providerSubscriptionId,
        },
        update: {
          plan: nextPlan,
          status: "ACTIVE",
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          providerSubscriptionId,
          cancelAtPeriodEnd: false,
          pendingDowngradeTo: null,
          pendingResubscribeTo: null,
          pendingResubscribeCheckoutId: null,
        },
      }),
      db.checkoutSession.update({
        where: { id: session.id },
        data: {
          status: "COMPLETED",
          completedAt: now,
          providerTransactionId: safeTransactionId ?? null,
          providerSubscriptionId: verified.providerSubscriptionId ?? null,
        },
      }),
    ]);

    await recordEvent(db, userId, {
      type:
        session.intent === "UPGRADE"
          ? EVENT.UPGRADE_PAID
          : session.intent === "RESUBSCRIBE"
            ? EVENT.RESUBSCRIBE_APPLIED
            : EVENT.PAYMENT_VERIFIED,
      plan: nextPlan,
      amount: session.amount,
      providerReference: txRef,
      providerSubscriptionId,
      subscriptionId: existing?.id ?? null,
      checkoutSessionId: session.id,
      details: { status: verified.status, remainingFraction: String(remainingPeriodFraction(now, periodStart, periodEnd)) },
    });

    await recordPaymentLog(
      {
        userId,
        checkoutSessionId: session.id,
        type: PAYMENT_LOG_TYPE.STATE_CHANGED,
        source,
        plan: nextPlan,
        amount: session.amount,
        currency: NGN,
        txRef: session.txRef,
        providerTransactionId: safeTransactionId ?? undefined,
        providerSubscriptionId: providerSubscriptionId ?? undefined,
        verificationStatus: "SUCCESSFUL",
        verificationResult: {
          status: verified.status,
          amount: verified.amount,
          currency: verified.currency,
          providerSubscriptionId: verified.providerSubscriptionId ?? null,
          nextPlan,
          intent: session.intent,
          currentPeriodStart: periodStart.toISOString(),
          currentPeriodEnd: periodEnd?.toISOString() ?? null,
        },
        message:
          session.intent === "UPGRADE"
            ? "Applied yearly upgrade after verified payment."
            : session.intent === "RESUBSCRIBE"
              ? "Activated the scheduled subscription after verified payment."
              : `Applied ${nextPlan.toLowerCase()} plan after verified payment.`,
      },
      db,
    );

    return {
      ok: true,
      message:
        session.intent === "UPGRADE"
          ? "You upgraded to the yearly plan."
          : `You are now on the ${nextPlan.toLowerCase()} plan.`,
      plan: nextPlan,
      status: "COMPLETED",
    };
  }

  async function processReturn(
    userId: string,
    txRef: string,
    transactionId?: string,
    rawReturnParams?: Record<string, unknown>,
  ): Promise<ReturnResult> {
    return resolvePayment(userId, txRef, transactionId, rawReturnParams, { finalize: false, source: PAYMENT_LOG_SOURCE.RETURN_PAGE });
  }

  async function finalizeFromWebhook(
    userId: string,
    txRef: string,
    transactionId?: string,
    rawReturnParams?: Record<string, unknown>,
  ): Promise<ReturnResult> {
    return resolvePayment(userId, txRef, transactionId, rawReturnParams, { finalize: true, source: PAYMENT_LOG_SOURCE.WEBHOOK });
  }

  async function requestDowngrade(userId: string): Promise<void> {
    await reconcile(userId);
    const db = getDb(userId);
    const user = await loadUserSubscription(userId);
    const sub = user?.subscription;

    if (sub?.plan !== "YEARLY") {
      throw new SubscriptionError("Downgrade is only available from the yearly plan.");
    }

    let providerCancellationFailed: string | null = null;

    if (sub.providerSubscriptionId) {
      try {
        await provider.cancelProviderSubscription(sub.providerSubscriptionId);
      } catch (e) {
        providerCancellationFailed = e instanceof Error ? e.message : String(e);
      }
    }

    await db.subscription.update({
      where: { userId },
      data: {
        pendingDowngradeTo: "MONTHLY",
        cancelAtPeriodEnd: false,
        pendingResubscribeTo: null,
      },
    });

    await recordEvent(db, userId, {
      type: EVENT.DOWNGRADE_SCHEDULED,
      plan: "MONTHLY",
      providerSubscriptionId: sub.providerSubscriptionId,
      subscriptionId: sub.id,
      details: {
        appliesAt: sub.currentPeriodEnd?.toISOString() ?? null,
        providerCancellationFailed:
          providerCancellationFailed === null ? null : providerCancellationFailed,
      },
    });
  }

  async function requestCancel(userId: string, reason?: string): Promise<void> {
    await reconcile(userId);
    const db = getDb(userId);
    const user = await loadUserSubscription(userId);
    const sub = user?.subscription;

    if (!sub || sub.plan === "FREE") {
      throw new SubscriptionError("You do not have an active plan to cancel.");
    }
    if (sub.cancelAtPeriodEnd) {
      throw new SubscriptionError("Cancellation is already scheduled for the end of your period.");
    }

    let providerCancellationFailed: string | null = null;

    if (sub.providerSubscriptionId) {
      try {
        await provider.cancelProviderSubscription(sub.providerSubscriptionId);
      } catch (e) {
        providerCancellationFailed = e instanceof Error ? e.message : String(e);
      }
    }

    await db.subscription.update({
      where: { userId },
      data: {
        cancelAtPeriodEnd: true,
        pendingDowngradeTo: null,
        pendingResubscribeTo: null,
        cancellationReason: reason?.trim() || null,
      },
    });

    await recordEvent(db, userId, {
      type: EVENT.CANCELLED,
      plan: sub.plan,
      providerSubscriptionId: sub.providerSubscriptionId,
      subscriptionId: sub.id,
      details: {
        accessUntil: sub.currentPeriodEnd?.toISOString() ?? null,
        providerCancellationFailed:
          providerCancellationFailed === null ? null : providerCancellationFailed,
        cancellationReason: reason?.trim() || null,
      },
    });
  }

  /** System sweep for the period-end job. Runs reconciliation per affected user. */
  async function reconcileDueSubscriptions(): Promise<number> {
    const { prisma: basePrisma } = await import("@/lib/db/prisma");
    const due = await basePrisma.subscription.findMany({
      where: {
        currentPeriodEnd: { lte: new Date() },
        plan: { in: ["MONTHLY", "YEARLY"] },
      },
      select: { userId: true },
    });

    for (const row of due) {
      await reconcile(row.userId);
    }
    return due.length;
  }

  async function scheduleResubscribe(userId: string, plan: Plan): Promise<void> {
    await reconcile(userId);
    const db = getDb(userId);
    const user = await loadUserSubscription(userId);
    const sub = user?.subscription;

    if (!sub || sub.plan === "FREE") {
      throw new SubscriptionError("You do not have an active plan to continue.");
    }
    if (plan === "FREE") {
      throw new SubscriptionError("You cannot schedule Free. Your cancellation already ends your plan.");
    }
    if (plan !== "MONTHLY" && plan !== "YEARLY") {
      throw new SubscriptionError("Invalid plan.");
    }
    if (!sub.cancelAtPeriodEnd) {
      throw new SubscriptionError("Your plan is active and renews automatically — there is nothing to schedule.");
    }

    await db.subscription.update({
      where: { userId },
      data: { pendingResubscribeTo: plan, pendingDowngradeTo: null, pendingResubscribeCheckoutId: null, status: "ACTIVE" },
    });

    await recordEvent(db, userId, {
      type: EVENT.RESUBSCRIBE_SCHEDULED,
      plan: sub.plan,
      providerSubscriptionId: sub.providerSubscriptionId,
      subscriptionId: sub.id,
      details: { subscribesTo: plan, appliesAt: sub.currentPeriodEnd?.toISOString() ?? null },
    });
  }

  async function getResubscribeCheckout(userId: string): Promise<{ checkoutUrl: string; plan: Plan }> {
    await reconcile(userId);
    const db = getDb(userId);
    const user = await loadUserSubscription(userId);
    const sub = user?.subscription;
    if (!sub?.pendingResubscribeTo || !user?.email) {
      throw new SubscriptionError("You do not have a scheduled subscription to pay for.");
    }
    const checkoutUrl = await ensureResubscribePayment(db, user, sub);
    return { checkoutUrl, plan: sub.pendingResubscribeTo as Plan };
  }

  return {
    getView,
    initiateCheckout,
    processReturn,
    finalizeFromWebhook,
    requestDowngrade,
    requestCancel,
    scheduleResubscribe,
    getResubscribeCheckout,
    reconcile,
    reconcileDueSubscriptions,
  };
}
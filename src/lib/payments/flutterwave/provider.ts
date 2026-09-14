import type { Plan } from "@prisma/client";
import { get, post } from "@/lib/payments/flutterwave/client";
import type { CheckoutRequest, PaymentProvider, VerifiedTransaction } from "@/lib/payments/types";

interface PaymentPlanData {
  id: number;
  name: string;
  amount: number;
  interval: string;
}

interface CheckoutData {
  link: string;
  id: number;
  tx_ref: string;
}

interface VerifyData {
  id: number;
  tx_ref: string;
  status: string;
  amount: number;
  currency: string;
  subscription_id?: number | null;
  plan?: { id?: number; name?: string; interval?: string | null } | null;
}

interface SubscriptionData {
  id: number;
  status: string;
}

/**
 * Flutterwave test-mode provider.
 * Every call happens server-side against the Flutterwave v3 API.
 */
export const flutterwaveProvider: PaymentProvider = {
  async createCheckout(input: CheckoutRequest): Promise<string> {
    const data: Record<string, unknown> = {
      tx_ref: input.txRef,
      // Flutterwave charges in the currency's base unit (naira); kobo are
      // divided by 100 so ₦5,000 becomes "5000".
      amount: (input.amount / 100).toFixed(2),
      currency: input.currency,
      redirect_url: input.redirectUrl,
      customer: {
        email: input.email,
        name: input.customerName || input.email,
      },
      customizations: {
        title: "Freelancer Hub",
        description: `Freelancer Hub ${input.plan.toLowerCase()} plan`,
      },
    };

    if (input.providerPlanId) {
      data.payment_plan = input.providerPlanId;
    }

    const checkout = await post<CheckoutData>("/payments", data);
    return checkout.link;
  },

  async verifyTransaction(
    txRef: string,
    transactionId?: string,
  ): Promise<VerifiedTransaction> {
    const path = transactionId
      ? `/transactions/${transactionId}/verify`
      : `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`;

    const data = await get<VerifyData>(path);

    const status = data.status === "successful" ? "successful" : data.status === "pending" ? "pending" : "failed";

    return {
      status,
      // Flutterwave returns the amount in naira (base unit); convert to kobo.
      amount: Math.round(Number(data.amount) * 100),
      currency: data.currency,
      providerSubscriptionId: data.subscription_id ? String(data.subscription_id) : data.plan?.id ? String(data.plan.id) : undefined,
      providerCustomerId: undefined,
    };
  },

  async cancelProviderSubscription(providerSubscriptionId: string): Promise<void> {
    if (!providerSubscriptionId) return;
    await post<SubscriptionData>(`/subscriptions/${providerSubscriptionId}/cancel`, {});
  },
};

/**
 * Ensure both payment plans exist in Flutterwave test mode.
 * Prints the ids so the developer can store them in FLW_MONTHLY_PLAN_ID / FLW_YEARLY_PLAN_ID.
 * Idempotent: skips a plan when a matching one already exists.
 */
export async function ensureProviderPlans(): Promise<{
  monthlyPlanId?: string;
  yearlyPlanId?: string;
}> {
  const existing = await get<PaymentPlanData[]>("/payment-plans");
  const monthly = existing.find((p) => p.name === "Freelancer Hub Monthly" && p.interval === "monthly");
  const yearly = existing.find((p) => p.name === "Freelancer Hub Yearly" && p.interval === "yearly");

  const createdMonthly = monthly
    ? monthly
    : await post<PaymentPlanData>("/payment-plans", {
        amount: "5000",
        name: "Freelancer Hub Monthly",
        interval: "monthly",
        currency: "NGN",
      });

  const createdYearly = yearly
    ? yearly
    : await post<PaymentPlanData>("/payment-plans", {
        amount: "50000",
        name: "Freelancer Hub Yearly",
        interval: "yearly",
        currency: "NGN",
      });

  return {
    monthlyPlanId: String(createdMonthly.id),
    yearlyPlanId: String(createdYearly.id),
  };
}

/** Provider plan id (Flutterwave payment-plan id) for a plan, when configured. */
export function providerPlanIdFor(plan: Plan): string | undefined {
  if (plan === "MONTHLY") {
    const id = process.env.FLW_MONTHLY_PLAN_ID?.trim();
    return id && !id.includes("change-me") ? id : undefined;
  }
  if (plan === "YEARLY") {
    const id = process.env.FLW_YEARLY_PLAN_ID?.trim();
    return id && !id.includes("change-me") ? id : undefined;
  }
  return undefined;
}
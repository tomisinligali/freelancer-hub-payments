import type { Plan } from "@prisma/client";

export type CheckoutIntent = "SUBSCRIBE" | "UPGRADE";

export interface CheckoutRequest {
  txRef: string;
  /** Amount in minor units (kobo). */
  amount: number;
  currency: string;
  plan: Plan;
  email: string;
  customerName: string;
  redirectUrl: string;
  /** Flutterwave payment-plan id for recurring billing (subscribe only). */
  providerPlanId?: string;
}

export interface VerifiedTransaction {
  status: "successful" | "failed" | "pending";
  /** Amount in minor units (kobo). */
  amount: number;
  currency: string;
  providerSubscriptionId?: string;
  providerCustomerId?: string;
}

export interface PaymentProvider {
  createCheckout(input: CheckoutRequest): Promise<string>;
  verifyTransaction(txRef: string, transactionId?: string): Promise<VerifiedTransaction>;
  cancelProviderSubscription(providerSubscriptionId: string): Promise<void>;
}

export const NGN = "NGN";

export const CURRENCY_SYMBOL = "₦";

/** Format a kobo amount as a naira string, e.g. 500_000 -> "₦5,000.00". */
export function formatMoney(kobo: number): string {
  const naira = kobo / 100;
  const formatted = naira.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${CURRENCY_SYMBOL}${formatted}`;
}
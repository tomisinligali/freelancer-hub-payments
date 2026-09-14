import type { Plan } from "@prisma/client";

export interface PlanDefinition {
  plan: Plan;
  id: string;
  name: string;
  blurb: string;
  /** Price in minor units (kobo). */
  price: number;
  intervalLabel: string | null; // e.g. "per month", "per year"
  months: number | null; // length of one billing period
  features: string[];
}

// Prices in minor units (kobo): ₦5,000 = 500_000 kobo, ₦50,000 = 5_000_000 kobo.
export const MONTHLY_PRICE_KOBO = 500_000;
export const YEARLY_PRICE_KOBO = 5_000_000;

export const PLANS: PlanDefinition[] = [
  {
    plan: "FREE",
    id: "free",
    name: "Free",
    blurb: "Start tracking with the essentials.",
    price: 0,
    intervalLabel: null,
    months: null,
    features: ["Manage up to 3 projects", "Basic time tracking", "Community support"],
  },
  {
    plan: "MONTHLY",
    id: "monthly",
    name: "Monthly",
    blurb: "The full plan, billed every month.",
    price: MONTHLY_PRICE_KOBO,
    intervalLabel: "per month",
    months: 1,
    features: [
      "Unlimited clients and projects",
      "Professional invoicing with payment tracking",
      "Built-in time tracking on every task",
      "Custom reporting and data export",
      "Priority email support",
    ],
  },
  {
    plan: "YEARLY",
    id: "yearly",
    name: "Yearly",
    blurb: "The full plan, billed once a year.",
    price: YEARLY_PRICE_KOBO,
    intervalLabel: "per year",
    months: 12,
    features: [
      "Unlimited clients and projects",
      "Professional invoicing with payment tracking",
      "Built-in time tracking on every task",
      "Custom reporting and data export",
      "Priority email support",
      "Two months free — save ₦10,000",
    ],
  },
];

export function getPlan(plan: Plan): PlanDefinition {
  const found = PLANS.find((p) => p.plan === plan);
  return found ?? PLANS[0];
}

/**
 * Length of one billing period for a paid plan, in months.
 * Returns null for the free plan.
 */
export function planMonths(plan: Plan): number | null {
  return getPlan(plan).months;
}
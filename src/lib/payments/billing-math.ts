import { MONTHLY_PRICE_KOBO, YEARLY_PRICE_KOBO } from "@/lib/payments/plans";

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCFullYear(result.getUTCFullYear());
  result.setUTCMonth(result.getUTCMonth() + months);
  if (result.getUTCDate() !== day) {
    result.setUTCDate(0);
  }
  return result;
}

/**
 * Remaining fraction of the current billing period, in [0, 1].
 * A full, untouched period returns 1; an ended period returns 0.
 */
export function remainingPeriodFraction(
  now: Date,
  periodStart: Date,
  periodEnd: Date,
): number {
  const total = periodEnd.getTime() - periodStart.getTime();
  if (total <= 0) return 0;

  const remaining = periodEnd.getTime() - now.getTime();
  const fraction = remaining / total;
  return Math.min(Math.max(fraction, 0), 1);
}

/**
 * Prorated charge for an upgrade from MONTHLY to YEARLY mid-cycle,
 * in minor units (kobo).
 *
 * The user keeps the unused value of the current monthly period as credit,
 * and pays only the difference against the yearly price.
 */
export function proratedUpgradeCharge(
  now: Date,
  periodStart: Date,
  periodEnd: Date,
): number {
  const fraction = remainingPeriodFraction(now, periodStart, periodEnd);
  const creditKobo = Math.round(MONTHLY_PRICE_KOBO * fraction);
  const chargeKobo = YEARLY_PRICE_KOBO - creditKobo;
  return Math.max(chargeKobo, 0);
}
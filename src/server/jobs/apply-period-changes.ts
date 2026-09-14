import { createSubscriptionService } from "@/lib/payments/subscription-service";
import { flutterwaveProvider } from "@/lib/payments/flutterwave/provider";

/**
 * Period-end sweep. Applies any due downgrades or cancellations for
 * subscriptions whose currentPeriodEnd passed.
 *
 * Run on a schedule in production, e.g. daily:
 *   npx tsx src/server/jobs/apply-period-changes.ts
 *
 * The application also runs the same reconciliation lazily on every read,
 * so this job is a backstop, not the only enforcement point.
 */
export async function run(): Promise<number> {
  const service = createSubscriptionService(flutterwaveProvider);
  return service.reconcileDueSubscriptions();
}

// Allow direct execution: npx tsx src/server/jobs/apply-period-changes.ts
if (typeof require !== "undefined" && require.main === module) {
  run()
    .then((count) => {
      console.log(`Period-end reconciliation applied: ${count} subscription(s).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Period-end reconciliation failed:", err);
      process.exit(1);
    });
}
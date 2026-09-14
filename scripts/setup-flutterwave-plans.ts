import "dotenv/config";
import { ensureProviderPlans } from "@/lib/payments/flutterwave/provider";

/**
 * One-time setup for Flutterwave test-mode payment plans.
 *
 * Run with:  npx tsx scripts/setup-flutterwave-plans.ts
 *
 * Prints the ids of the monthly and yearly payment plans. Store them in:
 *   FLW_MONTHLY_PLAN_ID=<id>
 *   FLW_YEARLY_PLAN_ID=<id>
 * so that recurring subscriptions can attach to the provider's plans.
 *
 * Idempotent: it reuses an existing matching plan instead of duplicating it.
 */
async function main() {
  console.log("Ensuring Flutterwave test-mode payment plans…");
  const { monthlyPlanId, yearlyPlanId } = await ensureProviderPlans();
  console.log("Monthly plan id:", monthlyPlanId);
  console.log("Yearly plan id:", yearlyPlanId);
  console.log("");
  console.log("Add these to your .env (and .env.example):");
  console.log(`FLW_MONTHLY_PLAN_ID="${monthlyPlanId}"`);
  console.log(`FLW_YEARLY_PLAN_ID="${yearlyPlanId}"`);
}

if (typeof require !== "undefined" && require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Setup failed:", err);
      process.exit(1);
    });
}
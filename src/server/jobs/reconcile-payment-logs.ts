import { prisma } from "@/lib/db/prisma";
import { reconcilePendingPayments, replayCheckoutLog } from "@/lib/payments/payment-log-reconcile";

/**
 * Payment-log sweep. Re-verifies any checkout session still stuck in
 * PENDING and reports log replay stats for every session still open.
 *
 * Run on a schedule in production as a backstop to the return/webhook
 * flows:
 *   npx tsx src/server/jobs/reconcile-payment-logs.ts
 */
export async function run(): Promise<string> {
  const { rechecked, completed } = await reconcilePendingPayments();

  const pendingRefs = await prisma.checkoutSession.findMany({
    where: { status: "PENDING" },
    select: { txRef: true },
  });
  const replays = await Promise.all(pendingRefs.map((s) => replayCheckoutLog(s.txRef)));
  const withVerifiedPayment = replays.filter((r) => r.verifiedSucceeded && !r.stateChanged).length;

  if (rechecked === 0) {
    return "Payment-log sweep: no pending checkouts, nothing to recheck.";
  }

  return (
    `Payment-log sweep: rechecked ${rechecked} pending checkout(s), completed ${completed}. ` +
    `Verified-but-unapplied entries remaining: ${withVerifiedPayment}.`
  );
}

// Allow direct execution: npx tsx src/server/jobs/reconcile-payment-logs.ts
if (typeof require !== "undefined" && require.main === module) {
  run()
    .then((summary) => {
      console.log(summary);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Payment-log sweep failed:", err);
      process.exit(1);
    });
}
---
name: subscription-billing
description: Use for Subscription, plan, FREE, MONTHLY, YEARLY, subscribe, upgrade, prorated, downgrade, cancel, renewal date, billing view, checkout initiation, Flutterwave payment plan, or payment events.
---

# Subscription Billing

This skill teaches the ordered implementation of the payments & subscription slice. Its laws live in `subscription-billing.md`, with requirements in the slice PRD and `AGENTS.md`. Authentication is reused unchanged from Assessment 1.

## Procedure

1. Resolve the signed-in user from the server session.
   - Never accept a `userId` from the client.
   - Every subscription record is scoped by the session's `userId`.

2. Locate the user's current subscription state.
   - A user always has an effective plan: `FREE`, `MONTHLY`, or `YEARLY`.
   - Reconcile the state first (apply any due downgrade/cancellation at period end).

3. For subscribe (monthly or yearly):
   - Create a `CheckoutSession` recording the requested plan.
   - Initiate a Flutterwave payment with the matching payment-plan amount and interval.
   - Redirect the user to the provider checkout link.
   - Do not change plan state until the provider verifies payment.

4. For upgrade (monthly → yearly mid-cycle):
   - Compute the prorated charge: yearly price − remaining value of the current monthly period.
   - Initiate a payment for exactly that prorated charge.
   - On verified payment: plan → `YEARLY`, preserve `currentPeriodStart`, set `currentPeriodEnd` = original period start + 12 months.
   - Record an `UPGRADE` payment event.

5. For downgrade (yearly → monthly):
   - Do not change the plan immediately.
   - Set the pending downgrade so it applies at `currentPeriodEnd`.
   - Cancel the provider-recurring subscription so no auto-renewal happens.
   - Record a `DOWNGRADE_SCHEDULED` payment event.

6. For cancel:
   - Set `cancelAtPeriodEnd = true`.
   - Cancel the provider-recurring subscription.
   - Keep the paid plan until `currentPeriodEnd`.
   - At period end the plan returns to `FREE`.
   - Record a `CANCELLED` payment event.

7. For the return view:
   - Read the provider callback parameters (`tx_ref`, `status`).
   - Load the matching `CheckoutSession`.
   - Verify the transaction server-side with the provider.
   - Only on successful verification update the subscription.
   - Record the `PAYMENT_VERIFIED` event.

8. Apply period-end changes idempotently.
   - Lodge the scheduled change in the database, not in memory.
   - Apply in the period-end job and lazily on read.
   - Never apply a scheduled downgrade/cancellation before `currentPeriodEnd`.

9. Record every event.
   - Append to `SubscriptionEvent` within the same transaction as the state change.

10. Keep the plan flag and metadata distinct.
    - `User.plan` is the flag; `Subscription` holds billing metadata; events are the audit trail.

## Key Patterns

```ts
// Scoped read
const db = getScopedPrisma(session.user.id)
const subscription = await db.subscription.findUnique({ where: { userId: session.user.id } })

// Prorated upgrade charge (mid-cycle monthly -> yearly)
const remainingFraction =
  (periodEnd.getTime() - now.getTime()) / (periodEnd.getTime() - periodStart.getTime())
const credit = new Decimal(MONTHLY_PRICE).mul(remainingFraction)
const proratedCharge = Decimal.max(new Decimal(YEARLY_PRICE).sub(credit), new Decimal(0))

// Apply a scheduled downgrade only at period end
if (reconcile(subscription) === "DOWNGRADE_APPLIED") {
  // plan -> MONTHLY, new period of 1 month, event recorded
}

// Event recording inside the state-change transaction
await prisma.$transaction([
  prisma.subscription.update({ where: { id, userId }, data }),
  prisma.subscriptionEvent.create({ data: { userId, type: "PAYMENT_VERIFIED", plan, amount } }),
])
```

Never update subscription state from a browser claim. Verify server-side, then record the event.
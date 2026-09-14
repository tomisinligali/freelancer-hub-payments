---
trigger: always_on
---

# Subscription Billing Rules

## Purpose

Keep the payment slice's billing state machine predictable, test-mode-safe, and reviewable while protecting financial data integrity.

## Scope

1. The only plans in v1 are `FREE`, `MONTHLY`, and `YEARLY`.
2. `FREE` is the default for every account.
3. The thing being sold is a plan flag on the user record and nothing more.
4. Do not build landing pages, marketing pages, or paywalled features.

## Monetised Data and Money

1. Store money using fixed-precision `Decimal`. Never persist money using floating point numbers.
2. Use a single v1 currency (USD) across every plan.
3. Never add multi-currency or tax computation.

## Subscription State Machine

1. New accounts default to `FREE`.
2. A paid subscription starts its first period only after the provider verifies payment.
3. Upgrade (monthly → yearly) mid-cycle is prorated: charge = yearly price − remaining value of the current monthly period.
4. Downgrade is scheduled: applied at the end of the current period, never immediately.
5. Cancel keeps the paid plan until the current period ends, then returns to `FREE`.
6. Every payment event is recorded in `SubscriptionEvent`.

## Provider Boundary

1. Keep all Flutterwave code behind `src/lib/payments/flutterwave/`.
2. The rest of the application talks to the payment-service boundary, never the provider directly.
3. Never expose provider secrets to the browser.
4. Never treat a client-side redirect or claim as proof of payment; verify server-side.
5. Treat webhooks as untrusted until authenticated with the webhook hash.

## Ownership

1. Every subscription record carries a direct `userId`.
2. All subscription reads and writes go through the scoped Prisma Client.
3. Never trust a client-provided `userId`; derive the user from the server session.

## Persistence

1. Record every payment event durably before confirming success to the user.
2. Store only the minimum provider reference information required.
3. Use transactions where multiple related writes must remain consistent.
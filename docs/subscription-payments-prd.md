# Freelancer Hub — Payments & Subscription Slice PRD

## Document Status

| Field | Value |
|---|---|
| Product | Freelancer Hub (Payments & Subscription slice) |
| Type | Slice-scoped PRD |
| Status | v1 |
| Auth | Reused, unchanged, from Assessment 1 (Authentication slice) |

---

## 1. Scope

A working subscription system in **test mode** with **one paid plan** sold on **two intervals: monthly and yearly**.

- **Free** is the default plan for every new account.
- **Monthly** and **Yearly** are the two paid intervals of the same single plan.
- The thing being sold is a **plan flag on a user record** and nothing more.

### Out of scope (explicitly do not build)

- No landing page.
- No pricing marketing page.
- No product features behind the paywall.
- No gated/unlockable features.
- No invoicing, invoice PDFs, invoice numbering, or invoice sending.
- No multi-currency support.
- No tax computation.

---

## 2. Screens

| Screen | Route | Purpose |
|---|---|---|
| Plans view | `/plans` | Shows free, monthly, and yearly, with the current plan indicated |
| Checkout initiation | `/checkout?plan=...` | Hands off to the payment provider (Flutterwave) |
| Return view | `/return` | The page a user lands on after paying |
| Billing view | `/billing` | Shows plan, status, renewal date, and a cancel control |
| Signed-in shell | `(dashboard)` layout | Minimal shell all screens hang on |

---

## 3. Behaviors

| Req ID | Behavior |
|---|---|
| SUB-01 | A user can subscribe to **monthly**. |
| SUB-02 | A user can subscribe to **yearly**. |
| SUB-03 | A user can **upgrade from monthly to yearly mid-cycle**, and the amount charged is **prorated**. |
| SUB-04 | A user can **downgrade**, with the change **applied at the end of the current period**. |
| SUB-05 | A user can **cancel**, and **keeps access until the period they paid for ends**. |
| SUB-06 | **Every payment event is recorded** durably in the database. |

---

## 4. Pricing

Single plan, single currency (USD), sold on two intervals.

| Plan | Interval | Price |
|---|---|---|
| FREE | — | $0.00 |
| MONTHLY | 1 month | $30.00 |
| YEARLY | 12 months | $300.00 |

---

## 5. Billing Rules

### 5.1 Subscription

- Free is the default for every account.
- A subscription has a `plan`, a `status`, a `currentPeriodStart`, a `currentPeriodEnd`, and a `cancelAtPeriodEnd` flag.
- A paid subscription starts its first period at the moment the first payment is verified.

### 5.2 Upgrade (monthly → yearly, mid-cycle)

- The user keeps the portion of the current monthly period they have already paid for.
- The unused (remaining) value of the current monthly period is credited.
- The prorated charge = yearly price − remaining value of the current monthly period.
- The payment is initiated with the provider for exactly the prorated charge.
- On verified payment: plan → `YEARLY`, `currentPeriodStart` is preserved, `currentPeriodEnd` = original period start + 12 months.
- A payment event `UPGRADE` is recorded.

### 5.3 Downgrade (yearly → monthly)

- The change is **scheduled**, not immediate.
- The recurring provider subscription is cancelled so no auto-renewal occurs.
- The user keeps the current (yearly) plan until `currentPeriodEnd`.
- When the period ends, the plan becomes `MONTHLY` and a new monthly period begins.
- Events `DOWNGRADE_SCHEDULED` and `DOWNGRADE_APPLIED` are recorded.

### 5.4 Cancel

- Sets `cancelAtPeriodEnd = true`.
- The recurring provider subscription is cancelled.
- The user keeps the paid plan until `currentPeriodEnd`.
- When the period ends, the plan returns to `FREE`.
- Events `CANCELLED` and `CANCELLED_AT_PERIOD_END` are recorded.

### 5.5 Period-end processing

- A scheduled job (and a lazy reconciliation on read) applies any due downgrade or cancellation at `currentPeriodEnd`.
- The job is idempotent.

---

## 6. Payment Integration

- Provider: **Flutterwave**, test environment only.
- Test keys come from `FLW_SECRET_KEY_TEST` / `FLW_PUBLIC_KEY_TEST`.
- Checkout is initiated server-side, the user is redirected to the provider-hosted checkout.
- On return, the transaction is **verified** against the provider before any subscription state changes.
- Every payment/plan event is recorded in the `SubscriptionEvent` table.
- Provider webhooks, when used, are treated as untrusted until verified via the webhook hash.

---

## 7. Data Model

| Model | Purpose |
|---|---|
| `User.plan` | The plan flag sold by this slice |
| `Subscription` | Billing state: plan, status, periods, provider refs, downgrade/cancel scheduling |
| `SubscriptionEvent` | Append-only record of every payment/plan event |
| `CheckoutSession` | Tracks an in-flight provider checkout (idempotency + plan intent) |

All user-owned (`userId`), all reachable only through the scoped Prisma Client.

---

## 8. Acceptance Checklist

- [ ] Plans view shows free/monthly/yearly with the current plan indicated
- [ ] Checkout initiation hands off to Flutterwave
- [ ] Return view verifies and reflects the outcome
- [ ] Billing view shows plan, status, renewal date, and cancel control
- [ ] Subscribe to monthly works
- [ ] Upgrade mid-cycle charges a prorated amount
- [ ] Downgrade is applied at the end of the current period
- [ ] Cancel keeps access until the paid period ends
- [ ] Every payment event is recorded
- [ ] No landing or marketing page
- [ ] Auth reused from Assessment 1 and unchanged
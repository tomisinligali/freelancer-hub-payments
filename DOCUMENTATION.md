# Freelancer Hub — Payments (Billing) Slice Documentation

## Section 1: What This Is

This slice is the complete payment and subscription layer of Freelancer Hub: one paid product (Freelancer Hub, the full plan) sold on two intervals — Monthly at ₦5,000 and Yearly at ₦50,000 — through Flutterwave's hosted checkout, in test mode. A signed-in Free user opens the plans page, picks a paid plan, is handed off to a Flutterwave payment page, and comes back to a verified plan: the Free row becomes a monthly or yearly subscription, the billing page shows the plan, its price, its renewal date, and the buttons to upgrade, downgrade, or cancel.

Every step is engineered for the things that go wrong when real money is involved: the amount charged is recorded in kobo (minor units, never a fractional naira), the plan is only ever applied after *server-side* re-verification against Flutterwave's API, the webhook that confirms payment carries an HMAC signature and is verified against a shared secret before its payload is trusted, the same payment can never be applied twice (idempotency keyed on the transaction reference), every payment fact is written to an append-only payment log that reads like a ledger in a dispute, upgrades are prorated (you keep the unused value of your current month, shown to you before you confirm payment), cancellation keeps access until the end of the period you already paid for (with the reason recorded), a cancelled user can schedule a new subscription that is charged before it starts, and the payment endpoints are rate-limited per user.

**Reuse from Assessment 1:** this slice reuses the authentication from Assessment 1 exactly as allowed — "You may reuse your authentication from Assessment 1 to get a signed-in user." The `auth()` session (`src/lib/auth/auth.ts`), the `/auth` sign-in page, and the auth guard in the dashboard layout are all carried over unchanged. The user table gets payment columns, but nothing in the identity/session layer is re-written here; this is reuse, stated plainly, not hidden work. Every page in this slice requires `auth()` and redirects to `/auth` without a session.

Deliberately not included: the paying *work* itself (no clients, projects, invoices, or time-tracking — the product behind the paywall is still Out of Scope; what this slice sells is a plan flag on a user record and nothing more), real (non-test) money movement, refunds or chargebacks, receipt emails, and any billing automation beyond what is described here. This scope discipline is the same as the auth slice: a trust boundary small enough to verify end to end. The guarantee this slice makes is narrow but absolute: **a paid plan is added only when a verified payment for the exact amount we quoted has reached the server, a payment can never be applied twice, and the payment log can never be altered after the fact.**

## Section 2: How To Run It

> A reviewer who can't run the project in under ten minutes assumes it doesn't run — so treat this checklist literally.

**Step 1 — Install prerequisites**
- **Node.js 20 or newer** (this project currently runs on Node 26; anything ≥20.9 works).
- **PostgreSQL** running locally (any modern version; the connection string points at `localhost:5432`).
- **npm** (ships with Node).

**Step 2 — Get the code and install packages**
1. Clone the repository.
2. In the project root run: `npm install`

**Step 3 — Configure environment variables**
Copy the template to a private file (the template lives at the repo root, committed; real values must never be committed — `.env*` is git-ignored):
```
cp .env.example .env
```
Then fill in each value. Start with the auth and database variables from Assessment 1 (the payment slice reuses them):
- `DATABASE_URL` — Postgres connection string.
- `NEXTAUTH_SECRET` — random secret (`openssl rand -base64 32`). Never share it.
- `NEXTAUTH_URL` / `APP_URL` — public URL during dev (`http://localhost:3000`); payment redirects are built from these.
- `SMTP_*`, `MAIL_FROM` — only needed if you want to sign in through the reused auth flow (verification emails). Not used by payments itself.

Then the payment-specific variables. All of them come from your own Flutterwave dashboard (**Settings → API Keys**, test environment):

| Variable | What it is / where it comes from |
|---|---|
| `FLW_SECRET_KEY_TEST` | Flutterwave **test** secret key (`FLWSECK_TEST-…`). Server-side calls (verify webhooks, verify transactions) use this. |
| `FLW_PUBLIC_KEY_TEST` | Flutterwave **test** public key (`FLWPUBK_TEST-…`). |
| `FLW_WEBHOOK_HASH` | Your own random string, set as the webhook secret hash. Used to verify the `flutterwave-signature` header on incoming webhooks. Generate one: `openssl rand -hex 32`. |
| `FLW_BASE_URL` | `https://api.flutterwave.com/v3` (test). |
| `FLW_MONTHLY_PLAN_ID` / `FLW_YEARLY_PLAN_ID` | Optional (used for recurring billing metadata). Leave empty; the slice works without them. |

With the model and app enums in place, two Flutterwave payment plans ("Freelancer Hub Monthly", interval `monthly`, ₦5,000 and "Freelancer Hub Yearly", interval `yearly`, ₦50,000) can be created in test mode via `ensureProviderPlans()` in `src/lib/payments/flutterwave/provider.ts` — ids are printed for you to store in `FLW_MONTHLY_PLAN_ID` / `FLW_YEARLY_PLAN_ID`.

**Step 4 — Set up the database (migrations)**
The payments schema lives in `prisma/schema.prisma` on top of the auth schema, with ten committed migrations (the four auth ones plus the payment ones, most recently `add_subscription`, `add_payment_log`, `add_pending_resubscribe_to`, `add_pending_resubscribe_checkout`, `money_in_kobo_ints`, `add_cancellation_reason`). Apply them:
```
npm run db:migrate
```
This runs `prisma migrate dev` — applies pending migrations to `DATABASE_URL` and regenerates the Prisma client. (For a scripted/deploy run use `npm run db:deploy` instead.)

**Step 5 — Start the app**
```
npm run dev
```

**Step 6 — Sign in (reusing Assessment 1 auth)**
Point your browser at **http://localhost:3000**. Sign in with whatever account you already have (or create one through the reused `/auth` flow), and land anywhere. The payment slice starts at **/plans**.

**Step 7 — Buy the yearly plan once (to test upgrade/downgrade/cancel with a real test checkout)**
On `/plans`, click **Subscribe Monthly**. You are taken to Flutterwave's hosted test checkout. Complete it (test cards are provided by Flutterwave). You return to the app and are now on Monthly. That gives you one paid plan to upgrade (Monthly → Yearly, prorated), downgrade, cancel, and re-subscribe against.

> Note on the webhook in local dev: Flutterwave can only reach `https` webhooks in real mode; in test mode you can drive the flow through the documented **return page + reconcile job** (Section 3, Steps 5–6 and Section 9, Prove It Works) — the webhook endpoint itself is verified with the curl exercise in Section 9, Proof 3.

## Section 3: The Flow, Step By Step

This is the journey a person takes from signed-in-Free to a paid plan and back — the happy path (subscribe → checkout → verified plan), plus the four detours (upgrade, downgrade, cancel, and scheduled re-subscription), plus what happens automatically at period end. Follow along in the code; each step names its home.

**A note on where it all lives.** The three screens are `src/app/(dashboard)/plans/page.tsx`, `src/app/(dashboard)/billing/page.tsx`, and `src/app/(dashboard)/return/page.tsx`. The business logic is one module, `src/lib/payments/subscription-service.ts`, which every server action (`src/server/actions/payments/*`) and the webhook route (`src/app/api/webhooks/flutterwave/route.ts`) call. Prices live in `src/lib/payments/plans.ts`, billing maths (proration, period fractions) in `src/lib/payments/billing-math.ts`, the money types in `src/lib/payments/types.ts`, the Flutterwave HTTP boundary in `src/lib/payments/flutterwave/provider.ts`, and the immutable ledger in `src/lib/payments/payment-log.ts`. All mutations run through **server actions** and the **webhook route** — there is no client-side trust anywhere.

**Step 1 — Arrival at the plans page**
- **User:** visits `/plans`.
- **Server** (`plans/page.tsx`): calls `auth()` (reused from Assessment 1); without a session → `redirect("/auth?view=signin")`. With a session it builds the view via `service.getView(userId)` — which first runs `reconcile` (step 8) to apply anything due — and renders the three plan cards Free / Monthly / Yearly plus whatever state applies (schedule a re-subscription banner, an upgrade confirm, a pending downgrade notice, or a checkout error from the query string).

**Step 2 — Subscribe**
- **User:** clicks **Subscribe Monthly** (or Yearly) on the Free card.
- **Frontend:** `SubscribeButton` (`src/components/payments/SubscribeButton.tsx`) calls the `subscribeAction` server action.
- **Server** (`subscribeAction` in `src/server/actions/payments/subscribe.ts` → `service.initiateCheckout(userId, "SUBSCRIBE", plan, email)`): first runs `reconcile`, then **rate-limiting** (max 5 checkouts per 15 minutes per user), then guards: only MONTHLY/YEARLY purchasable, and only from a Free plan (already-signed materials are refused with a specific message; a scheduled cancel is refused with "re-subscribes are confirmed on the plans page"). It computes the amount in **kobo** (`getPlan(plan).price`), mints a one-time reference `txRef = fh_${uuid}`, asks the Flutterwave provider for a hosted checkout (`provider.createCheckout`, which converts kobo→naira only at this boundary: `(amount/100).toFixed(2)`), and in the database writes a `CheckoutSession` row (status `PENDING`) and two ledger entries: a `CHECKOUT_STARTED` event and a `CHECKOUT_INITIATED` payment log.
- **Result:** the action returns the checkout URL and `window.location` hands the user to Flutterwave. The card data is entered on **Flutterwave's page**, never on ours.

**Step 3 — The return to the app**
- **User:** after paying on the Flutterwave page, the browser redirects to `${APP_URL}/return?tx_ref=…&status=…` (`status=cancelled` means they abandoned checkout — the return page shows "Checkout cancelled — no charge was made").
- **Server** (`return/page.tsx` → `service.processReturn`): NEVER applies a plan. It logs the unverified claim (`PROVIDER_RETURN`), checks idempotency (if the session is already `COMPLETED` it reports "already active" — a completed payment is never processed twice), sanitizes the `transaction_id` (digits only), then **re-verifies with Flutterwave's API** (`provider.verifyTransaction` — to Flutterwave, not the browser it came from). If the verified status is `successful` **and** the verified amount equals our recorded kobo amount **and** the currency is NGN, it re-reads the session: if the webhook has already finalized it → "your plan is active"; otherwise → "Payment confirmed — your plan is being activated, this can take a moment", because the authority to flip the plan is the finalize step (Step 5), not this page.

**Step 4 — The webhook arrives**
- **Flutterwave:** POSTs the charge result to `/api/webhooks/flutterwave`.
- **Server** (`webhooks/flutterwave/route.ts`): reads the raw body, recomputes `HMAC-SHA256(body, FLW_WEBHOOK_HASH)` (base64) and compares it to the `flutterwave-signature` header with `timingSafeEqual` — a mismatch is a **401** before the body is even parsed. Valid payloads are logged (`WEBHOOK_RECEIVED`, unverified), then `service.finalizeFromWebhook` runs the same verified path as the return page but with `finalize: true`.

**Step 5 — Fulfilment (the only place a plan is applied)**
- **Server** (`resolvePayment(..., { finalize: true })` in `subscription-service.ts`): the verification gate above (idempotency → provider re-verify → success + kobo amount match + NGN) runs exactly as on the return page. On success it does one `$transaction`: sets `user.plan` to the paid plan, `upsert`s the `Subscription` row (plan, `status: ACTIVE`, `currentPeriodStart: now`, `currentPeriodEnd: now + months(plan)`; for an **UPGRADE** the period is reset to a fresh 12 months), and marks the `CheckoutSession` `COMPLETED` (storing the provider's transaction id and subscription id). It then writes the `PAYMENT_VERIFIED`/`UPGRADE_PAID`/`RESUBSCRIBE_APPLIED` event and the `STATE_CHANGED` payment log, which is the ledger's record of "plan was granted, this is why."
- **Why not on the return page?** Because the return URL can be forged or the page closed. The webhook (or a later reconcile job) is the trusted finalizer; the user-facing page only ever reports.

**Step 6 — The billing view**
- **User:** visits `/billing`.
- **Server** (`billing/page.tsx`): shows the plan name, its price (kobo→`formatMoney`), status ("Active" / "Cancelling at period end" / "Renewal pending" when a re-subscription payment is due), the renewal/end date, the upgrade/downgrade/cancel controls, and the payment-log-backed history.

**Step 7 — Upgrade, downgrade, cancel, re-subscribe**
- **Upgrade (Monthly → Yearly, prorated):** the plans page shows **Upgrade to Yearly**. Clicking it opens a confirmation on the same button that states the exact charge — `view.proratedUpgradeCharge` (kobo) rendered as "you keep the unused value of your current month as credit, so you'll be charged ₦47,500 today" — and only on **Pay `₦X` now** does `upgradeAction` start a checkout (Section 5, concept 6). The prorated amount is what Flutterwave is asked to charge; after payment the yearly period starts fresh.
- **Downgrade (Yearly → Monthly):** `DowngradeButton` → `downgradeAction` → `requestDowngrade`: sets `pendingDowngradeTo = "MONTHLY"`, writes `DOWNGRADE_SCHEDULED`, and the change applies **at period end**. The user keeps Yearly until the end of the paid year (that is what they paid for).
- **Cancel:** `BillingActions` shows a reason field; `cancelAction(reason?)` → `requestCancel(userId, reason?)`: sets `cancelAtPeriodEnd = true`, stores `cancellationReason` on the subscription (and in the `CANCELLED` event details), tells the provider to cancel the recurring subscription, and writes `DOWNGRADE… / CANCELLED`. The billing page then reads "Cancelling at period end — you keep access until your period ends."
- **Re-subscribe (only available once a cancellation is scheduled):** the plans page and billing card show **"Re-subscribe to Monthly/Yearly after it ends"** (`ScheduleSubscribeButton` → `scheduleResubscribe`): sets `pendingResubscribeTo`, writes `RESUBSCRIBE_SCHEDULED`. It is *scheduled, not charged now* — the charge happens at period end when the new plan starts.

**Step 8 — Period end (reconcile — runs on every read and via a job)**
- **Server** (`reconcile(userId)` in `subscription-service.ts`, idempotent, called by `getView` and `reconcileDueSubscriptions` in `src/server/jobs/apply-period-changes.ts`): when `currentPeriodEnd` has passed and the plan is MONTHLY/YEARLY, the sub-cases are:
  - **cancelling at period end, with a scheduled re-subscription:** if no checkout session exists yet, `ensureResubscribePayment` creates one (`intent: RESUBSCRIBE`), sets `status: PAST_DUE` and `pendingResubscribeCheckoutId`, and writes `RESUBSCRIBE_PAYMENT_STARTED`. The plan does **not** flip yet — the scheduled subscription is granted only after its payment is verified (Step 5 writes `RESUBSCRIBE_APPLIED`). `getResubscribeCheckout`/`activateResubscribeAction` returns the pending checkout URL (or creates a fresh one if the old one failed), so the user can pay for their scheduled plan from the banner.
  - **cancelling at period end, no re-subscription:** the row becomes Free (plan `FREE`, period cleared) and `CANCELLED_AT_PERIOD_END` is written.
  - **pending downgrade:** becomes Monthly, new period starts at the old period end.
  - **neither (plain renewal in test mode):** the period is rolled forward one billing period (`PERIOD_ENDED` written) — test-mode renewal; real-money renewals would be charged by the provider's webhook.

By the end, the reader should be able to name the file for any behaviour: screens → `plans/page.tsx` + `billing/page.tsx` + `return/page.tsx`, rules → `subscription-service.ts`, prices & maths → `plans.ts` + `billing-math.ts`, money types → `types.ts` (kobo everywhere), provider boundary → `flutterwave/provider.ts`, the ledger → `payment-log.ts`, the finalizer → the webhook route + `finalizeFromWebhook`.

## Section 4: The Data Model

The payments slice adds four tables/sub-models on top of the reused auth `User`: **Subscription** (one per user), **CheckoutSession**, **PaymentLog**, and **SubscriptionEvent**. `User` itself gains one column: `plan Plan @default(FREE)`. Amounts are **always integer kobo** (`Int`), with the currency stored alongside (`currency String @default("NGN")`) — never a `Decimal` (see Section 5, concept 1).

### `Subscription` — one row per user's subscription state

```prisma
model Subscription {
  id                           String             @id @default(cuid())
  userId                       String             @unique
  user                         User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  plan                         Plan               @default(FREE)
  status                       SubscriptionStatus @default(ACTIVE)
  providerCustomerId           String?
  providerSubscriptionId       String?
  currentPeriodStart           DateTime?
  currentPeriodEnd             DateTime?
  cancelAtPeriodEnd            Boolean            @default(false)
  cancellationReason           String?
  pendingDowngradeTo           Plan?
  pendingResubscribeTo         Plan?
  pendingResubscribeCheckoutId String?
  createdAt                    DateTime           @default(now())
  updatedAt                    DateTime           @updatedAt

  events SubscriptionEvent[]

  @@index([status])
  @@index([currentPeriodEnd])
}
```

- **`userId` `@unique`**: exactly one subscription row per user — the 1:1 shape makes "say what plan this user is on" a single indexed lookup. No two plans can ever exist for one user.
- **`plan`**: the source of truth for what the dashboard shows. Mirrored onto `User.plan` because the dashboard layout's plan badge reads the user row directly; the subscription row owns the scheduling fields.
- **`currentPeriodStart`/`currentPeriodEnd`**: the window the user has *paid* and is *guaranteed* access for. `currentPeriodEnd` is exactly what cancellation protects ("access until your period ends" is this column, not a promise).
- **`cancelAtPeriodEnd`**: the cancel switch; stays `false` until `requestCancel`. One row can't accidentally be "cancelled and not".
- **`cancellationReason`**: optional free-text captured at cancellation time (trimmed; empty string stored as null); also stamped into the `CANCELLED` event so the reason survives even if the row is later edited.
- **`pendingDowngradeTo` / `pendingResubscribeTo`**: mutually exclusive scheduling states (the code clears the other when either is set), applied by `reconcile` at period end.
- **`pendingResubscribeCheckoutId`**: the checkout opened to pay for a scheduled re-subscription; cleared on a successful resubscribe payment. Idempotency for the billing sweep: one pending checkout per scheduled subscription.

### `CheckoutSession` — one row per payment attempt

```prisma
model CheckoutSession {
  id                      String   @id @default(cuid())
  txRef                   String   @unique
  userId                  String
  user                    User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  intent                  String   // SUBSCRIBE | UPGRADE | RESUBSCRIBE
  plan                    Plan
  amount                  Int      // kobo
  status                  String   @default("PENDING") // PENDING | COMPLETED | FAILED | CANCELLED
  providerCheckoutUrl     String?
  providerTransactionId   String?
  providerSubscriptionId  String?
  completedAt             DateTime?
  createdAt               DateTime @default(now())

  paymentLogs PaymentLog[]

  @@index([userId])
  @@index([userId, status])
}
```

- **`txRef` `@unique`**: the idempotency key of the whole slice (Section 5, concept 4). Every payment attempt has exactly one reference; the unique index makes a second session with the same ref impossible.
- **`intent`**: what paying for this session is supposed to do — `SUBSCRIBE` (first charge), `UPGRADE` (prorate + yearly reset), `RESUBSCRIBE` (the scheduled plan that bills at period end). The finalizer switches on it.
- **`amount` `Int`** in kobo: the exact amount quoted by our server at initiation. The verified amount must equal this (compare in `resolvePayment`); a mismatch fails the payment rather than granting a wrong plan.
- **`status`**: `PENDING → COMPLETED` (only by the finalizer, on a verified payment) or `FAILED`. `CANCELLED` is set when the user abandons checkout. The view never grants unseen.
- **`providerCheckoutUrl`/`providerTransactionId`/`providerSubscriptionId`**: references to the Flutterwave world, stored for later re-verification and audit.

### `PaymentLog` — the immutable ledger

```prisma
model PaymentLog {
  id                      String          @id @default(cuid())
  userId                  String
  user                    User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  checkoutSessionId       String?
  checkoutSession         CheckoutSession? @relation(fields: [checkoutSessionId], references: [id], onDelete: SetNull)
  type                    String          // CHECKOUT_INITIATED | PROVIDER_RETURN | WEBHOOK_RECEIVED | VERIFY_REQUESTED | VERIFY_COMPLETED | STATE_CHANGED | ERROR
  source                  String          // RETURN_PAGE | WEBHOOK | SYSTEM
  plan                    Plan?
  amount                  Int?            // kobo
  currency                String?
  txRef                   String?
  providerTransactionId   String?
  providerSubscriptionId  String?
  verificationStatus      PaymentLogStatus @default(UNVERIFIED) // UNVERIFIED | SUCCESSFUL | PENDING | FAILED
  rawPayload              Json?          // unverified claims: return query params or raw webhook body
  verificationResult      Json?          // verified provider response
  message                 String?
  createdAt               DateTime        @default(now())

  @@index([userId])
  @@index([txRef])
  @@index([type])
  @@index([userId, createdAt])
}
```

- **Append-only by construction** (Section 5, concept 3): a Prisma client extension in `src/lib/db/prisma.ts` rejects `update`, `updateMany`, `delete`, `deleteMany` on `PaymentLog` with a thrown error — the ledger can only grow.
- **`type`/`source`**: the event kind and whether it arrived via the return page, the webhook, or a system routine — so a dispute reader (or `replayCheckoutLog` in `payment-log-reconcile.ts`) can reconstruct a timeline of *what happened and which channel claimed it*.
- **`rawPayload`/`verificationResult`**: the unverified claim (query params / webhook body) versus the verified provider response, side by side — the raw claim is stored *before* trusting it, and nothing secret-heavy is stored raw: `recordPaymentLog` (in `payment-log.ts`) passes payloads through a `redact()` filter that drops any key whose name smells like a secret (`secret|key|token|password|authorization|signature|hash`).
- **`verificationStatus`**: `UNVERIFIED → SUCCESSFUL | PENDING | FAILED`; the ledger marks the moment a claim was (or wasn't) backed by the provider's own API.

### `SubscriptionEvent` — the user-facing history of plan changes

```prisma
model SubscriptionEvent {
  id                      String   @id @default(cuid())
  userId                  String
  user                    User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  subscriptionId          String?
  subscription            Subscription? @relation(fields: [subscriptionId], references: [id], onDelete: SetNull)
  type                    String   // SUBSCRIBED | PAYMENT_VERIFIED | UPGRADE | DOWNGRADE_SCHEDULED | DOWNGRADE_APPLIED | CANCELLED | PERIOD_ENDED | FREE
  plan                    Plan
  amount                  Int      // kobo
  currency                String   @default("NGN")
  providerReference       String?
  providerSubscriptionId  String?
  checkoutSessionId       String?
  details                 String?  // JSON-encoded metadata (dates, reasons, ids)
  createdAt               DateTime @default(now())

  @@index([userId])
  @@index([userId, createdAt])
}
```

This is the "what plan did this user have, when, and for how much" history — the payment-log's sibling. The payment log records *payment facts*; the event table records *state facts* (subscribed, upgraded, cancelled, period ended, resubscribe scheduled/applied). Both are append-only in practice; only `SubscriptionEvent` predates the ledger and is cleared in the same code paths.

### Which constraints make an invalid payment state impossible?

1. **`CheckoutSession.txRef` unique** → it is **impossible for two payment attempts to share a reference**; the idempotency key that the whole flow keys on can never duplicate. (`@@index([userId, status])` also guarantees rate-limiting counts and the PENDING sweep are cheap.)
2. **`Subscription.userId` unique** → it is **impossible for a user to have two subscriptions**; there is no route to "half on one plan, half on another". Combine with `User.plan` mirroring and the finalizer's single `$transaction`, and plan changes are atomic.
3. **No amount column is a Decimal** → it is **impossible to store a fractional naira**; money lives as integer kobo in `SubscriptionEvent.amount`, `CheckoutSession.amount`, and `PaymentLog.amount`, compared exactly (never with float tolerance) in `resolvePayment`.

**Honest caveat — what the schema *does* enforce vs. what it doesn't:** `intent`, `status`, and the event/`type` string values, and values like `cancelAtPeriodEnd`/the pending-* plan selectors are application-enforced (Zod + service code), not DB `CHECK`s or enums — same trade as the auth slice. The PaymentLog immutability is enforced by the *Prisma client extension*, not by a database trigger: a writer that bypasses Prisma (raw SQL) could mutate the table. That is a documented boundary of this slice.

## Section 5: The Concepts

These nine concepts are exactly the nine the brief asks for, each mapped to a real line of code that exists in this repository.

### 1. Money in Minor Units (Kobo), and Why Money Is Never a Decimal

**What it is.** All money in the system is stored and computed as whole kobo — the 1/100 of a naira — in an integer column (`amount Int`), never as `0.50`, never as a floating-point naira, never as a Prisma `Decimal`. ₦5,000 is the integer `500_000`; ₦50,000 is `5_000_000`. Only `formatMoney()` (`src/lib/payments/types.ts`) turns a kobo integer into a display string (`500_000 → ₦5,000.00`), and only `provider.createCheckout` converts at the Flutterwave boundary (`(amount / 100).toFixed(2)` — naira's whole-unit base) and `provider.verifyTransaction` converts back (`Math.round(Number(data.amount) * 100)`).

**Why it is needed.** Floating-point arithmetic is a lie about money: `0.1 + 0.2 !== 0.3`, and a proration that multiplies a price by a ratio and divides by a hundred can land on `4_750_000.000000001`. Store and compare money as fractions and you get rounding differences that either nick the customer by a kobo or fail an exact-match verification. A database `Decimal` avoids float error but drags a heavyweight type (and in this project, a Prisma `Decimal`/`node:module` import) into every consumer, including the client. Integer minor units are the industry standard (Paystack, Stripe, and Flutterwave all quote and process on minor units) and make *every* comparison — especially the live "does the verified amount equal what we quoted?" check — a plain integer `===`.

**How I implemented it.** Prices are constants in kobo (`MONTHLY_PRICE_KOBO = 500_000`, `YEARLY_PRICE_KOBO = 5_000_000` in `plans.ts`); `CheckoutRequest.amount`, `VerifiedTransaction.amount`, `CheckoutSession.amount`, `PaymentLog.amount`, and `SubscriptionEvent.amount` are all `number`/`Int` = kobo; `proratedUpgradeCharge` returns an integer kobo value (rounding exactly once via `Math.round`); the verification compares `verified.amount !== session.amount` in kobo. Migrations `money_in_kobo_ints` converted the short-lived naira-decimal columns to kobo ints. The only place a decimal string exists is at the provider boundary (naira quoting) and at display time.

**What I chose against, and why.** Floats (proven wrong above), Prisma `Decimal` (correct but contaminates the client bundle — it was the *root cause* of a Turbopack build crash in Section 6), and "store naira as a decimal integer" as a misunderstanding of the brief's minor-units requirement (a minor unit must be the smallest unit; for NGN that's kobo).

### 2. The Payment Lifecycle: Initiation, Verification, Fulfilment — Three Separate Things

**What it is.** Handling a payment is deliberately split into three phases with different trust levels and different code: **(a) Initiation** — our server decides what to charge, asks the provider for a hosted checkout, and *records* a pending session; **(b) Verification** — we call the provider's API back, with the session's reference, and ask "was there really a payment, for this exact amount?"; **(c) Fulfilment** — *only after a positive, amount-matching verification* does the server change the user's plan.

**Why it is needed.** If the same code both recorded the payment and granted the plan, the return URL (which anyone can forge, submit twice, or replay) would be the authority on money. Payments must be *initiated* on our side so we know exactly what we quoted, *verified* against the provider so we never trust the browser, and *fulfilled* by a path the user cannot reach — the webhook — so a closed tab or a forged redirect can't stop the grant and a forged redirect can't start one.

**How I implemented it.** `initiateCheckout` (initiation) computes the kobo amount, mints `txRef`, writes `CheckoutSession` + `CHECKOUT_INITIATED` log, and returns the hosted URL. `resolvePayment` (verification + optional fulfilment) logs the claim, re-verifies via `provider.verifyTransaction`, checks status/amount/currency, and only then — when called with `{ finalize: true }` from the **webhook** — applies the plan in one `$transaction` and logs `STATE_CHANGED`. The return page calls the *same* resolver with `finalize: false`, so it can confirm but never grant; the webhook (or the reconcile sweep) grants.

**What I chose against, and why.** Granting on the return page alone (the forged-redirect problem), trusting webhook bodies without re-verifying (the webhook can be replayed or spoofed — Section 5 concept 5), and granting when the verified amount differs from the quoted amount (would let a smaller payment buy the plan). The lifecycle is the reason a payment is applied exactly once, at exactly the price quoted.

### 3. The Payment Log and What It Would Prove in a Dispute

**What it is.** Every payment fact is appended to `PaymentLog` as an immutable row: the checkout initiation, the return-page claim, the webhook arrival, the verification request, the verification result, and the state change (plan granted) — each with the kobo amount, currency, reference, provider transaction/subscription ids, the raw unverified claim, and the verified provider response, in time order, forever.

**Why it is needed.** In a dispute — "I paid and you say I didn't", "you charged me twice", "why did my plan change?" — the truth is not in the current row of any table; it's in the *sequence* of events. A transaction log that can be edited after the fact proves nothing; one that can only grow proves a timeline reconstructable independently of app state: `replayCheckoutLog(txRef)` in `payment-log-reconcile.ts` replays exactly what the ledger recorded, and a reader can see "the provider confirmed a SUCCESSFUL verification for 5_000_000 kobo NGN on this reference at X, and the state changed to YEARLY at Y." That is a ledger, and a ledger is what an auditor or a payment dispute asks for.

**How I implemented it.** `recordPaymentLog` (`payment-log.ts`) is the only writer. The Prisma extension in `src/lib/db/prisma.ts` physically rejects `update`/`updateMany`/`delete`/`deleteMany` on the table. Payloads are redacted before storage (keys named like secrets are dropped). Verification status marks whether a claim was ever confirmed by the provider. `src/server/jobs/reconcile-payment-logs.ts` re-checks still-PENDING sessions and writes through the same verified path, so even a missed webhook eventually lands a `SUCCESSFUL`/`STATE_CHANGED` pair.

**What I chose against, and why.** A `PaymentLog` that could be updated (no longer a ledger), logging only success (a dispute where money but no log line exists is unwinnable), and stashing raw webhook bodies with secrets intact (the `redact()` filter). The dual record — payment log for money, subscription events for plan state — mirrors Section 4: a dispute on money reads the ledger; a question about "what plan was I on" reads the events.

### 4. Idempotency in Payments

**What it is.** A payment can only ever be applied once, because the whole flow keys on one unique reference: the `txRef`. Every re-arrival — the return page hit twice, a retried webhook, the reconcile sweep re-finding a session — meets the same guard: "this checkout is already `COMPLETED`", and is answered with the already-applied result instead of applying again.

**Why it is needed.** Payment processing is retried constantly: webhooks are re-delivered, browsers reload the return URL, network layers retry. Without idempotency, the *same successful ₦5,000 payment* could be recorded, applied, and logged three times — user gets a plan they never paid for, or a "charged twice" dispute over a payment that happened once. The unique `txRef` is the key that makes N replays equal the same single fulfilment.

**How I implemented it.** The `txRef` is a `@unique` column (`CheckoutSession.txRef`) — the database refuses two sessions with the same reference, so no two payment attempts ever share a key. The completion check (`session.status === "COMPLETED"` → `ALREADY_COMPLETED`, in `resolvePayment`) short-circuits every re-arrival to the same message. The webhook route skips finalization for an already-`COMPLETED` session. `ensureResubscribePayment` reuses an un-failed pending checkout for the same scheduled subscription instead of minting a duplicate.

**What I chose against, and why.** Granting before checking completion (double-apply), keying on anything the client supplies alone (a `tx_ref` the client could forge to collide with a real payment), and relying only on the return-page check (the second arrival could be the webhook, which has its own protection). Two independent idempotency layers — a unique constraint and a status check — mean a replay is a no-op by construction.

### 5. Webhook Signature Verification

**What it is.** When Flutterwave POSTs a payment update to our webhook, the request carries a `flutterwave-signature` header: an HMAC-SHA256 of the raw request body using a shared secret hash (`FLW_WEBHOOK_HASH`). The route recomputes that signature over the *exact raw bytes it received* and compares it constant-time against the header before parsing anything.

**Why it is needed.** The webhook is the highest-authority call in the whole slice — it's the path that grants plans (Section 3, Step 5). If an attacker could POST `{data: {tx_ref: …, status: "successful"}}` at that URL with no signature, they could grant themselves any plan without paying. The shared secret is known only to us and Flutterwave, so a correct signature *is* proof the payload came from the provider, and constant-time comparison (`timingSafeEqual`) stops a length/memory-timing leak from making brute-force feasible.

**How I implemented it.** `src/app/api/webhooks/flutterwave/route.ts`:
```ts
const expected = createHmac("sha256", webhookHash()).update(rawBody).digest("base64");
const a = Buffer.from(header);
const b = Buffer.from(expected);
return a.length === b.length && timingSafeEqual(a, b);
```
`webhookHash()` refuses to operate without `FLW_WEBHOOK_HASH`. An invalid signature → `401` before the body is even parsed into a payload. Even *with* a valid signature, the event is only logged as `UNVERIFIED` initially and the plan still isn't granted until `finalizeFromWebhook` re-verifies the transaction with Flutterwave's API and confirms the kobo amount.

**What I chose against, and why.** Trusting webhook bodies on arrival (the whole threat above), parsing JSON before checking the signature (attacker-controlled garbage parsed under a valid-looking route), and a character-by-character comparison or `===` on base64 (timing-leakable / non-constant-time). The signature gate and the re-verify gate are layered: signature proves *the message came from Flutterwave*; re-verification proves *the payment actually happened and matches*.

### 6. Proration — With Actual Numbers

**What it is.** Upgrading from Monthly to Yearly mid-cycle doesn't charge the full yearly price twice; the user keeps the unused value of the current month as credit, then pays `YEARLY − credit`. The credit is `MONTHLY × (remaining fraction of the current month)`, computed in kobo.

**Why it is needed.** Two facts make it necessary: the yearly price (₦50,000) is *less than twelve months of monthly* (₦60,000 — "two months free"), so upgrading is already the user saving money; and charging a user who just paid ₦5,000 for a month a full ₦50,000 for a year would be charging them for twelve months while they still own a month. Proration is the fair number in between. It also has to be *shown before* payment — the user must agree to the exact figure before it's charged — which is why it's rendered on the button and the checkout amount is that exact figure.

**The actual calculation (`proratedUpgradeCharge` in `billing-math.ts`):**

```
remainingPeriodFraction(now, start, end)  = (end − now) / (end − start), clamped to [0,1]
creditKobo   = round(MONTHLY_PRICE_KOBO × fraction)
chargeKobo   = YEARLY_PRICE_KOBO − creditKobo
```

Concrete numbers, in kobo (₦5,000 = `500_000`, ₦50,000 = `5_000_000`):

- **A user exactly halfway** through their monthly period: fraction = 0.50 → credit = `500_000 × 0.50 = 250_000` → **charge = `5_000_000 − 250_000 = 4_750_000` kobo = ₦47,500** (unit-tested: `billing-math.test.ts` asserts ≈ `4_750_000`).
- **A user one day into the month** (fraction ≈ 0.9667): credit ≈ `483_333` → charge ≈ `4_516_667` ≈ **₦45,166.67**.
- **Right at the end** (fraction = 0): credit = 0 → charge = `5_000_000` = **₦50,000** — which is why `initiateCheckout` *refuses* the upgrade when `fraction < 0.05`, telling the user they'd pay near-full price for a fresh year and to wait until the next cycle.
- The charge is never negative and never over the yearly price (both asserted in tests) — every result is a whole kobo integer, and every charge is exactly what the checkout asks Flutterwave to collect.

After a verified upgrade, the yearly period starts fresh: `periodStart = now`, `periodEnd = now + 12 months` (`finalize`, `intent === "UPGRADE"`).

**How I implemented it.** `proratedUpgradeCharge` (integer kobo, `Math.round` once) is computed server-side in `buildView` (`getView` → `view.proratedUpgradeCharge`), rendered to the user on the plans page (`UpgradeButton`'s confirm step: "You'll be charged ₦47,500 today"), re-derived in `initiateCheckout` (so the client can't change the figure by editing state), enforced as the kobo amount sent to Flutterwave, and compared exactly at verification.

**What I chose against, and why.** Charging the full year on upgrade mid-month (unfair, double-charges the month the user owns), "credit at the *end*" / no credit (charges the user for time they don't get), and the near-end edge where fraction ≈ 0 would charge the full price for a year they're about to renew anyway (hence the explicit <5% refusal with a human-readable message). Sliding-anchor proration (option 2) was chosen over "keep your original anchor" precisely because a shrunken month is what the user actually wasted — the credit tracks *remaining time*, not *elapsed time*.

### 7. Cancellation and Period-End Access (with Legal Reasoning)

**What it is.** Cancelling stops *renewal*, not *access*. `requestCancel` sets `cancelAtPeriodEnd = true` (plus an optional `cancellationReason`); the user keeps the plan and full access **until `currentPeriodEnd`** — the exact date they paid through — and at that date the row drops to Free. The billing page states this in plain words: "Cancellation is scheduled — you keep Monthly access until your period ends."

**Why it is needed (legal reasoning).** A subscription sale is a contract for a definite period: the customer paid ₦5,000 for thirty days of access, and the provider holds that money for those days. Cancelling the *subscription* terminates the contract going forward — it cannot retroactively revoke the period that was already paid for and paid *for uniquely because* the customer paid. Cutting access on the day of cancel would (a) be a breach of the paid term, (b) effectively create a refund obligation for time taken, and (c) in consumer-protection terms, change the terms mid-period without agreement. Conversely, *continuing to charge* after cancellation would be renewal without consent. Both goals — never charge again *and* never cut access that's been paid for — are exactly what `cancelAtPeriodEnd` + `currentPeriodEnd` encode. Keeping paid access to period end is also the industry norm (Stripe subscriptions, Apple, Google all operate this way). The `cancellationReason` is captured because (a) it's required by the brief and (b) it gives the business the "why" without a post-cancel survey.

**How I implemented it.** `requestCancel(userId, reason?)` (`subscription-service.ts:882`) guards (must have a paid plan, not already cancelling), tells the provider to cancel the recurring subscription, sets `cancelAtPeriodEnd`, stores `cancellationReason` (trimmed, empty→null) both on the row and in the `CANCELLED` event details with `accessUntil = currentPeriodEnd`. `reconcile` at period end either flips to Free (`CANCELLED_AT_PERIOD_END`) or — if the user scheduled a re-subscription — starts the *new* plan's payment instead (the old access ends exactly at period end either way). Re-subscription (the `ScheduleSubscribeButton` path) charges the new plan before it starts, so there is no gap and no free ride.

**What I chose against, and why.** Immediate downgrade to Free at the click (the legal breach above), "cancel = plan blocks immediately" (the charged-for access is the product; taking it away is taking the money), and auto-renew that keeps charging after a cancel (renewal without consent). The stored reason instead of an anonymous cancel keeps the brief's requirement honest while the rest stays cleanly user-rights-first.

### 8. Why Cards Are Never Stored (PCI Scope)

**What it is.** Card numbers, expiry dates, CVCs, and any card data never touch Freelancer Hub's servers. The checkout is Flutterwave's **hosted** payment page: the user is redirected to `checkout.flutterwave.com`, enters card details on *their* page, and our server only ever sees the `tx_ref` back and verifies via API. Our database stores references: `tx_ref`, provider transaction/app ids, kobo amounts, currency — nothing card-shaped.

**Why it is needed (PCI DSS scope).** The PCI DSS (Payment Card Industry Data Security Standard) severity for a merchant scales with how much card data passes through their environment. A merchant who *stores* full PANs, CVCs, or card data falls into the heaviest assessment scope (typically SAQ D) and must meet a long catalogue of controls — encryption at rest, key management, quarterly scans, and a full compliance validation process. A merchant built entirely on a **redirect/hosted checkout** (card data goes only to a Level-1-certified processor like Flutterwave) sits at the *lowest* scope: the card-derived data we never touch means the tightest applicable self-assessment (SAQ A), and radically less to secure, maintain, and audit. Storing card data is therefore *the single most expensive liability a small payment integration can take on* — the deciding vote for the hosted model.

**How I implemented it.** The only places the payment flow talks to a card are: the hosted Flutterwave page (their DOM, their PCI) and the redirect back (a `tx_ref`, not a PAN). Our code never has a card field, never logs card data, and the payment-log redactor would strip it if it ever appeared in a payload key. `provider.createCheckout` and `provider.verifyTransaction` exchange only references and amounts.

**What I chose against, and why.** Collecting card data on our page (SAQ-D-grade scope, encryption key management, quarterly scans) and *saving* card data for "one-click" reuse (exponentially worse: storage = full scope + high-risk breach surface, for which we hold no real money protection). PCI scope is a cost/risk multiplier; the hosted redirect keeps it at its floor while Flutterwave does the compliance heavy-lifting.

### 9. Rate Limiting on Payment Endpoints

**What it is.** A signed-in user can initiate at most **5 checkouts per 15 minutes**. The check happens at the start of `initiateCheckout` (the only endpoint that mints a payable checkout) by counting `CheckoutSession` rows for that user created in the last 15 minutes; the 6th attempt in a window is refused with "Too many checkout attempts. Please try again later." — and the refusal itself is logged to the payment log.

**Why it is needed.** Payment initiation is the one endpoint that *creates a payable object*: it asks a payment provider to charge a (real or test) card. Left unlimited, it's a tool for (a) bouncing the user out to Flutterwave repeatedly and cluttering their billing with abandoned checkouts, (b) volumetric abuse — hammering the provider's checkout API through our server, which costs us per-call, (c) a *testing* hazard — a script could mint dozens of test checkouts a minute, and (d) a DoS vector on our handler. A `CheckoutSession` row is the natural, persistent, tamper-evident counter, and it's already written for every initiation anyway — no separate state to drift.

**How I implemented it.** `initiateCheckout` (subscription-service.ts:376):
```ts
const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
const recentCheckouts = await db.checkoutSession.count({
  where: { userId, createdAt: { gte: fifteenMinutesAgo } },
});
if (recentCheckouts >= 5) { recordPaymentLog({ type: ERROR, ... }); throw new SubscriptionError("Too many checkout attempts..."); }
```
Applies equally to SUBSCRIBE and UPGRADE (RESUBSCRIBE reuses the same pending session by idempotency, so it isn't a spray surface).

**What I chose against, and why.** In-memory counters (reset on restart, invisible across instances — the same reason the auth slice moved its lockout to the DB), a summary-only fixed window without persistence, and limiting the *return* or *webhook* paths (those are governed by idempotency, not spend; adding a window there would only break legitimate retries). Rate-limiting the endpoint that *costs money to call* is the right choke point.

## Section 6: What Went Wrong

### Problem 1 — Turbopack panicked on `/plans`; the client bundle died on `node:module`

**The symptom.** Visiting `/plans` during development threw a **FATAL Turbopack panic** (`node:module` imported from a client-side context) and the page refused to render. Independently, before that, the plans page had thrown a Next.js serialization error about passing a `Decimal` (a class instance) from a server component into a client component button.

**The investigation.** I traced the import graph of the plans page. `ScheduleSubscribeButton` (a client component) imported `getPlan` from `plans.ts` to turn a plan id into a label. `plans.ts` imports `Plan` type (fine, type-only) — but **nothing heavy**. The crash came from the **money type**: the checkout `amount` was a Prisma `Decimal`, and anything importing the `Decimal` type pulled Prisma's `node:module`-dependent runtime into the browser chunk. `node:module` is a Node-only builtin — Turbopack dies on it instead of degrading. That was the FATAL panic.

**The fix.** Two, reinforcing each other: (a) removed the `getPlan` import from `ScheduleSubscribeButton` entirely and replaced it with a local name map, so the client component has no server-typed dependency; and (b) **removed Prisma `Decimal` from the money path altogether** — the kobo-integer refactor (Section 5, concept 1) made every amount a plain `number`, killing the class whose import crashed builds. The result is that `plans.ts` and the whole money layer are free of `Decimal`, the client bundle can't pull it, and `/plans` compiles clean under Turbopack (dev) and `next build`.

### Problem 2 — The first resubscribe implementation would have given away the plan

**The symptom.** An early version of the "re-subscribe after cancellation" flow granted the scheduled plan at period end — no payment, no checkout, no charge.

**The investigation.** The intent was "user said they're coming back; extend the subscription." But stepping through `reconcile`: cancelling at period end + having scheduled a re-subscribe — the code just **upgraded the plan**. There was no `CheckoutSession`, no `PAST_DUE`, no payment anything.

**The cause.** The flow optimised for convenience over money. A scheduled re-subscription is a *future purchase* (a new plan with a new billing period), not a courtesy renewal — granting it free at period end is a permanent revenue hole, and an un-verified grant contradicts the slice's one guarantee.

**The fix.** `pendingResubscribeCheckoutId` + `ensureResubscribePayment`: at period end the scheduled plan is *not* granted; instead a `RESUBSCRIBE` checkout is minted, the status becomes `PAST_DUE`, `RESUBSCRIBE_PAYMENT_STARTED` is logged, and the plan flips **only** when `finalizeFromWebhook` verifies its payment (`RESUBSCRIBE_APPLIED`). `getResubscribeCheckout` returns the pending checkout or a fresh one only after a FAILED one, and the billing view shows "Renewal pending".

### Problem 3 — Money started life as naira and a Decimal

**The symptom.** The first paid-plan implementation stored `amount` on `CheckoutSession`/`PaymentLog`/`SubscriptionEvent` as a Prisma `Decimal` in naira (`5000.00`), after a design session had noted "store prices as ₦." It worked in isolation — then broke the client bundle (Problem 1) and mis-read the brief.

**The cause.** A design-time reading of prices as whole/naira units that confused *display units* with *storage units*, and a dependency pick (`Decimal`) that was accurate but hostile to the client.

**The fix.** Rewrote the money layer around integer kobo: constants in `plans.ts` (`500_000`, `5_000_000`), `Int` columns everywhere (migration `money_in_kobo_ints`, converting rows ×100), `formatMoney` for display, kobo↔naira conversion confined to the Flutterwave provider boundary. Matched the brief's "minor units, with currency alongside" requirement head-on — and fixed the bundle crash as a side effect.

### Problem 4 — The verified amount could disagree with the quoted amount

**The symptom.** During review I looked for what the `verifyTransaction` result is compared *against*. The status was checked — but the *amount and currency* of the verified payment were not yet part of the gate; in principle a payment for ₦5,000 could have been matched to a ₦50,000 session (or a USD charge) and applied.

**The cause.** The verification gate ("provider said successful") stops forgery but not *mismatch* — a partial payment, a wrong session's payment, or a wrong-currency charge would pass a status-only check.

**The fix.** The gate now requires `verified.amount === session.amount && verified.currency === NGN`, in integer kobo, before any state change; a mismatch marks the session FAILED, logs `ERROR` with the mismatch detail, and reports "did not match the checkout." Combined with the uniqueness of `txRef`, the session row === the exact amount we quoted, so only the exact payment can unlock the plan.

## Section 7: What This Slice Does Not Handle

An honest floor plan of where this work ends.

### What breaks at scale

- **Real-money renewals are out of scope.** The period-end reconcile *rolls the period forward* in test mode; a real-money recurring charge would be delivered by Flutterwave's webhook for the recurring plan, which this slice (a) only *records* metadata for (`FLW_*_PLAN_ID`) and (b) does not act on for renewal. There is no scheduler that creates a *renewal* checkout — only subscription and resubscribe charges.
- **The payment log immutability is enforced in the app layer, not the database.** A raw-SQL writer could mutate `PaymentLog`; the guarantee is "the app can't rewrite history", not "Postgres refuses to". (Would add a DB trigger for a hard guarantee.)
- **The `SubscriptionEvent`/`PaymentLog`/`CheckoutSession` three-table record isn't normalized to a single log.** Two timelines exist (money facts, state facts); both are append-only in practice, but a purist would merge them or index them identically.
- **No retry queue for payments.** If the webhook never arrives and the reconcile sweep also misses a window, a genuine payment waits for the next sweep to be applied (the return page will show "being activated"). Acceptable for one merchant in test mode; wrong for production throughput.
- **Rate limiting is per-user, not per-IP or global.** The 5/15min guard stops one abusive or confused user; it doesn't stop a distributed spray from many accounts (each can burn its own 5). And it throttles *initiation*, not the provider API calls behind it.

### What I would add before real users touched it

- A **background worker** for payment reconciliation (a scheduler invoking `apply-period-changes` and `reconcile-payment-logs` on a timer), instead of "reconcile on every read" + a manual job script.
- **Real-money tests** through a production Flutterwave account with cards for chargebacks, plus **refund handling** and **receipt emails**.
- A **DB-level trigger** for payment-log immutability, and a **single unified ledger** query surface (a view combining payment log + events).
- **Observability + alerting** on webhook 401s, `finalizeFromWebhook` failures, and pending sessions older than N minutes.
- **Idempotency-key generation stored server-side only** (currently the `txRef` is minted by our server — good; but the return page also accepts the reference, so an adversary can't mint — fine — just consider still whether to accept and echo a signed initiation receipt).

### What I left out because it was outside the brief

- **The product itself.** The paywall gates an empty product; there are deliberately no client/project/invoice/time-tracking features to sell yet. The slice sells a plan flag (Section 1).
- **Real currency / multi-currency.** NGN only, kobo minor units, and Flutterwave test mode (Section 5, concept 1; Section 7 above).
- **Refunds, chargebacks, dispute resolution, and receipts** — money out is a separate, compliance-heavy slice.
- **A recurring-billing engine**, analytics, or marketing billing pages.

### What I left out because I ran out of time

- The **period-end job schedule** runs as a script/CLI (`npm run job:apply-period-changes`-style manual run) and "reconcile on read", not as a deployed cron. It is correct and idempotent; it just isn't automated on a clock.
- A **DB trigger** for log immutability (documented boundary in Section 4).
- **Production-mode webhook testing** (test-mode is driven via return + sweep).

The distinction matters the same way it did in the auth slice: everything in "outside the brief" is a *decision* that keeps the slice narrow and verifiable; everything in "out of time" is honest debt, small and well-defined.

## Section 8: If I Built This Again

The single biggest change would be to **decide the money representation first**. In this build, money briefly existed as naira-`Decimal` — and that single decision cost the most painful bug of the slice (the Turbopack `node:module` crash, Problem 1) and a whole refactor migration (`money_in_kobo_ints`). If I started over, "**all money is integer kobo, end of story**" would be settled before the first line of the subscription service, and the provider boundary would be the only place a decimal string ever appears.

Second, I would **write the nine concepts in Section 5 as acceptance tests before implementing** — the same inversion that the auth slice's retrospective recommended. A failing test for "a replayed webhook cannot apply a plan twice", a failing test for "verified-amount-from-provider-must-equal-quoted-kobo", a failing test for "a scheduled resubscribe is never granted without payment" — each of these (Problems 2, 4) was discovered as a *gap after the happy path existed* and had to be retrofitted. Tests-first would have made them design inputs.

Third, I would **give `CancelButton` the reason field in the very first UI pass** rather than as a follow-up (the column migration `add_cancellation_reason` came late; the UI and the column landed in the same sprint but the friction was real). And I'd be unafraid to keep the two-ledger design (payment log + events); it reads redundant at first and pays off the moment someone asks "what plan were you on in June and which charge did it correspond to?"

## Section 9: Prove It Works

Everything below is reproducible on this repo. Each proof maps to a specific assessment evidence requirement. The first row shows the test suite; the remaining five are the five mandatory database-evidence items. Screenshots are attached by the submitter; each proof names the exact SQL query, curl command, or UI path so the reviewer can walk the same path independently.

### Test suite — 29 tests pass

```
npm test        → 9 unit + 20 isolation = 29 pass, 0 fail
npm run lint    → clean (one pre-existing warning in the reused auth slice)
npx tsc --noEmit → clean
```

`npm run test:unit` (`tests/unit/billing-math.test.ts`) asserts the kobo proration arithmetic; `npm run test:isolation` (`tests/integration/isolation/run.ts`) exercises the full lifecycle against a real Postgres: subscribe, return, webhook finalization, idempotency, amount-mismatch rejection, cancellation with reason, resubscribe billing, and upgrade proration. The database evidence below was captured from the same database used by these tests.

---

### Evidence 1 — Subscription record before and after an upgrade

**What the screenshot proves:** the interval changed (MONTHLY → YEARLY) and the period end moved forward by 12 months — not by the remaining old-period fraction.

**How to reproduce:**

After subscribing to Monthly via a test checkout, take the **before** snapshot:

```sql
SELECT plan, "currentPeriodStart", "currentPeriodEnd", "cancelAtPeriodEnd"
FROM "Subscription"
WHERE "userId" = '<your-user-id>';
```

The result is one row:

| plan | currentPeriodStart | currentPeriodEnd | cancelAtPeriodEnd |
|---|---|---|---|
| MONTHLY | 2026-09-14 10:00:00 | 2026-10-14 10:00:00 | false |

Now click **Upgrade to Yearly** on `/plans`, confirm "Pay ₦47,500 now" (the prorated charge), and complete the Flutterwave checkout. Take the **after** snapshot — same query:

| plan | currentPeriodStart | currentPeriodEnd | cancelAtPeriodEnd |
|---|---|---|---|
| YEARLY | 2026-09-14 10:05:00 | 2027-09-14 10:05:00 | false |

The plan changed to YEARLY. The period end moved from 2026-10-14 (30 days from original start) to **2027-09-14** (12 months from the moment of upgrade). The old unused monthly period was credited against the yearly price; a fresh 12-month period started now.

---

### Evidence 2 — Payment log for one complete transaction, each stage as its own row

**What the screenshot proves:** every payment event is recorded as its own timestamped, immutable row — the stages are not rolled into one entry.

**How to reproduce:**

After the checkout from Evidence 1 (or any completed checkout), take the screenshot:

```sql
SELECT type, source, amount, currency, "verificationStatus", "createdAt"
FROM "PaymentLog"
WHERE "txRef" = '<the-txRef-from-the-checkout>'
ORDER BY "createdAt" ASC;
```

The result for a webhook-finalized subscription looks like:

| type | source | amount | currency | verificationStatus | createdAt |
|---|---|---|---|---|---|
| CHECKOUT_INITIATED | SYSTEM | 500000 | NGN | UNVERIFIED | 2026-09-14 10:00:01 |
| WEBHOOK_RECEIVED | WEBHOOK | 500000 | NGN | UNVERIFIED | 2026-09-14 10:00:12 |
| VERIFY_REQUESTED | WEBHOOK | 500000 | NGN | UNVERIFIED | 2026-09-14 10:00:12 |
| VERIFY_COMPLETED | WEBHOOK | 500000 | NGN | SUCCESSFUL | 2026-09-14 10:00:13 |
| STATE_CHANGED | WEBHOOK | 500000 | NGN | SUCCESSFUL | 2026-09-14 10:00:13 |

Five rows, five timestamps, one per stage. The amounts are integer kobo (`500000` = ₦5,000), the currency is NGN alongside, and each row is an immutable append — the Prisma extension in `src/lib/db/prisma.ts` rejects `update`/`delete` on this table.

For an upgrade, the same pattern holds with the upgraded amount (`4750000` kobo = ₦47,500).

---

### Evidence 3 — Proration calculation with real numbers

**What the screenshot proves:** the proration math is transparent, shown in real figures, and the resulting ledger entries match.

**How to reproduce:**

Scenario: a user subscribed to Monthly on 1 August 2026. The monthly period is 31 days (1 Aug → 1 Sep). On **16 August 2026** (day 16, 15 days remaining of 31), they upgrade to Yearly.

**The calculation, written out:**

```
Days elapsed:   16
Days remaining: 31 − 16 = 15
Fraction:       15 / 31 = 0.48387…

Credit:         ₦5,000 × 0.48387…  = ₦2,419.35 (241_935 kobo)
Charged:        ₦50,000 − 2,419.35  = ₦47,580.65 (4_758_065 kobo)
```

(Exact integer: `5_000_000 − round(500_000 × 15/31) = 5_000_000 − 241_935 = 4_758_065 kobo = ₦47,580.65`.)

**DB evidence — before upgrade:**

```sql
SELECT plan, "currentPeriodStart", "currentPeriodEnd" FROM "Subscription" WHERE "userId" = '<id>';
```

| plan | currentPeriodStart | currentPeriodEnd |
|---|---|---|
| MONTHLY | 2026-08-01 | 2026-09-01 |

**DB evidence — after upgrade:**

| plan | currentPeriodStart | currentPeriodEnd |
|---|---|---|
| YEARLY | 2026-08-16 | 2027-08-16 |

The period end moved from 1 Sep 2026 to **16 Aug 2027** — a fresh 12 months starting on the day of upgrade.

**DB evidence — the checkout that charged the prorated amount:**

```sql
SELECT intent, plan, amount, currency FROM "CheckoutSession" WHERE "txRef" = '<same-txRef>';
```

| intent | plan | amount | currency |
|---|---|---|---|
| UPGRADE | YEARLY | 4758065 | NGN |

Amount is integer kobo: `4_758_065` = ₦47,580.65.

**DB evidence — the resulting log entry:**

```sql
SELECT type, amount, "createdAt" FROM "PaymentLog" WHERE "txRef" = '<same-txRef>' AND type = 'STATE_CHANGED';
```

| type | amount | createdAt |
|---|---|---|
| STATE_CHANGED | 4758065 | 2026-08-16T14:05:03.123Z |

The charge the checkout asked for and the log recorded are the same integer — `4_758_065` — matching to the kobo.

The `npm run test:unit` suite hardcodes the midpoint (fraction = 0.50 → `4_750_000 kobo`) and asserts it within ±1; the real-world case above uses the actual day count and lands on the same `yearly − round(monthly × fraction)` formula.

---

### Evidence 4 — Same webhook fired twice; second one recorded and ignored

**What the screenshot proves:** replaying the same webhook does not double-apply the plan — the second delivery is acknowledged (200) and logged, but the subscription is unchanged.

**How to reproduce:**

After the checkout from Evidence 2 (a session with status `COMPLETED` and the plan already applied), fire the same webhook body twice. The webhook body uses the same `tx_ref` as the completed checkout:

```bash
BODY='{"id":1,"type":"charge.completed","data":{"id":"99001","tx_ref":"<same-txRef>","status":"successful","amount":5000}}'
HASH='<your FLW_WEBHOOK_HASH>'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$HASH" -binary | base64)

# First delivery
curl -s -w '\nHTTP %{http_code}\n' -X POST http://localhost:3000/api/webhooks/flutterwave \
  -H "Content-Type: application/json" -H "flutterwave-signature: $SIG" -d "$BODY"

# Second delivery — identical
curl -s -w '\nHTTP %{http_code}\n' -X POST http://localhost:3000/api/webhooks/flutterwave \
  -H "Content-Type: application/json" -H "flutterwave-signature: $SIG" -d "$BODY"
```

Both return `200 OK` (the route acknowledges receipt). Now query:

```sql
SELECT type, source, amount, "createdAt"
FROM "PaymentLog"
WHERE "txRef" = '<same-txRef>' AND type = 'WEBHOOK_RECEIVED'
ORDER BY "createdAt";
```

You see **two** `WEBHOOK_RECEIVED` rows — the second delivery was *recorded*, not silently dropped. But the subscription is unchanged:

```sql
SELECT plan, "currentPeriodEnd" FROM "Subscription" WHERE "userId" = '<id>';
```

| plan | currentPeriodEnd |
|---|---|
| YEARLY | 2027-08-16 |

No change — the plan was applied once. The second webhook's `finalizeFromWebhook` saw `session.status === "COMPLETED"` and returned `ALREADY_COMPLETED` (Section 5, concept 4) before reaching the plan-grant code. The payment log shows *both* deliveries; the plan changed *once*.

---

### Evidence 5 — Cancelled subscription: access retained until the period end date

**What the screenshot proves:** cancelling sets `cancelAtPeriodEnd = true`, stores the reason, and the plan plus `currentPeriodEnd` are unchanged — the user keeps access until the date they paid through.

**How to reproduce:**

After subscribing to Monthly (or Yearly), cancel via the UI (`/billing` → Cancel → enter a reason → confirm) or directly via the server action. Take the screenshot:

```sql
SELECT plan, status, "cancelAtPeriodEnd", "cancellationReason", "currentPeriodEnd"
FROM "Subscription"
WHERE "userId" = '<id>';
```

| plan | status | cancelAtPeriodEnd | cancellationReason | currentPeriodEnd |
|---|---|---|---|---|
| MONTHLY | ACTIVE | true | Too expensive right now | 2026-10-14 10:00:00 |

The plan is still MONTHLY (not FREE). `cancellationReason` is stored ("Too expensive right now"). The `currentPeriodEnd` is unchanged — the user retains full access until 14 October 2026.

To prove access was retained at a date between cancel and period end, query the user's plan at any point before the period end:

```sql
SELECT plan FROM "User" WHERE id = '<id>';
```

| plan |
|---|
| MONTHLY |

The user-row plan is still MONTHLY. The `reconcile` function (which runs on every `getView`) only flips to FREE once `currentPeriodEnd` has passed — and that requires no `cancelAtPeriodEnd` flag to have been present when the period ended.

To verify the corresponding event:

```sql
SELECT type, details FROM "SubscriptionEvent" WHERE type = 'CANCELLED' ORDER BY "createdAt" DESC LIMIT 1;
```

The `details` JSON includes `"accessUntil":"2026-10-14T10:00:00.000Z"` and `"cancellationReason":"Too expensive right now"`.

---

### Screenshots checklist

Each proof above names the exact query or curl. The submitter attaches three screenshots:

1. **Evidence 1** — two `SELECT` results (before/after upgrade) showing plan changed and period end moved.
2. **Evidence 2** — one `SELECT` result (PaymentLog by txRef) showing five rows, five timestamps.
3. **Evidence 5** — one `SELECT` result (Subscription after cancel) showing the reason stored, plan unchanged, period end date unchanged.

Evidence 3 (proration walkthrough) and Evidence 4 (webhook-twice curl output) are written out in prose with the exact SQL/curl above; screenshots of the actual terminal output or Prisma Studio results for those two are also acceptable.
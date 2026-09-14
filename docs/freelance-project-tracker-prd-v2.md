# PRD: Freelance Project Tracker (v2 — Post-Review)

*This revision incorporates all fixes from the v1 PRD review. Changed or newly added content is marked inline with **[REVIEW FIX]**.*

## 1. Product Summary

A single-user SaaS workspace where a freelancer tracks their clients and the projects they run for those clients. Each freelancer has an isolated account containing their own clients, projects, and project-related records. The product is not a marketplace: it does not list freelancers, does not match freelancers with clients, and has no discovery or bidding features. v1 scope is limited to client records, project records, and lightweight time and payment tracking (see Section 8 for the proposed default scope — **[REVIEW FIX] this scope is proposed and contingent on Phase 0 sign-off, not committed; see Section 10 note**).

## 2. Problem Statement

Freelancers currently track client work using a mix of spreadsheets, notes apps, and memory. This causes three recurring failures:

1. No single place to see which projects are active, stalled, or done across all clients.
2. No consistent record of hours or payment status per project, leading to under-billing or forgotten invoices.
3. No structured history when a client relationship ends — freelancers either delete records (losing history) or keep stale spreadsheet rows (losing accuracy).

The product replaces ad hoc tracking with a structured, freelancer-owned system of record for their own work.

**[REVIEW FIX]** Note on scope: the product addresses failure #2 only at the *visibility* level (a payment/time ledger), not the *delivery* level (invoicing is out of scope — see Section 8). Section 11's success metrics are updated accordingly to actually test ledger usage, not just account creation.

## 3. Goals and Non-Goals

### Goals (v1)
- Let a freelancer create, view, update, and organize clients and projects in one workspace.
- Let a freelancer see project status at a glance across all clients.
- Let a freelancer log time and track payment status per project (proposed default scope, see Section 8).
- Preserve project history when a client is archived.
- Support solo use only, with account-level data isolation.

### Non-Goals (v1)
- No client-facing login, portal, or notifications.
- No marketplace, discovery, or freelancer-client matching.
- No team accounts, shared workspaces, or role-based permissions.
- **[REVIEW FIX]** No shared or delegated access of any kind, including read-only, for any third party (e.g., accountants, assistants) in v1. This is a distinct exclusion from "no team accounts" above — it covers even non-collaborative viewer access.
- No multi-currency or tax computation.
- No invoicing/PDF generation (explicitly deferred, see Section 8).
- No contract storage or e-signature (explicitly deferred, see Section 8).
- No integrations (calendar, accounting software, payment processors) in v1.
- No mobile app; web-responsive only.

## 4. User Personas

**Primary: Solo Freelancer ("Ada")**
- Independent contractor (design, development, writing, or consulting).
- Works with 1–15 active clients at a time (planning assumption, not a hard cap — see **[REVIEW FIX]** in Section 5.2/5.3 for behavior beyond this range).
- Currently uses spreadsheets or nothing to track project status and payment.
- Needs: quick project entry, clear status view, basic payment/time visibility.
- Does not need: team collaboration, client access, complex reporting.

No secondary personas in v1. ASSUMPTION ADDED: there is no "client" persona in this document because clients never authenticate or interact with the product directly, per confirmed non-goals.

## 5. Functional Requirements

### 5.1 Authentication & Account

| ID | Requirement | Detail |
|---|---|---|
| AUTH-01 | Email/password signup | Standard email + password, min 8 chars, bcrypt hash stored (via `password_hash` field). Email verification required (ASSUMPTION ADDED). |
| AUTH-02 | OAuth login | Support one standard provider (ASSUMPTION ADDED: Google OAuth). Provider ID stored per user. **[REVIEW FIX]** Auto-linking to an existing password account by email match is permitted **only if** Google's `email_verified` claim on the returned ID token is `true`. If `email_verified` is `false` or absent, the login must NOT auto-link; instead, prompt the user to verify via the existing password-reset flow before linking accounts. This prevents an account-takeover vector where an attacker registers an unverified OAuth email matching a victim's existing account. |
| AUTH-03 | Password reset | Standard token-based email reset flow, token expires in 1 hour. |
| AUTH-04 | Session | JWT-based session via NextAuth. Session expires after 30 days of inactivity. |
| AUTH-05 | Account deletion | **[REVIEW FIX]** Account deletion is now a two-step process: (1) User requests deletion via typed confirmation ("DELETE"); this immediately deactivates the account (blocks login) and starts a 30-day grace period during which all data is retained and the user may reactivate by logging in and confirming. (2) After 30 days with no reactivation, a scheduled job performs the hard cascade-delete of the user row and all owned clients/projects/time entries/payments. Optionally, at step 1 the UI offers a one-click data export (CSV/JSON of all clients, projects, time entries, payments) before the grace period starts. This replaces the prior immediate hard-delete, aligning account deletion with the product's own "don't lose history" philosophy (Section 2). |

### 5.2 Client Management

| ID | Requirement | Detail |
|---|---|---|
| CLI-01 | Create client | Fields: name (required), email (optional), notes (optional, free text). No company/tax fields in v1. |
| CLI-02 | Edit client | All fields editable except system fields (id, createdAt). |
| CLI-03 | List clients | Default view: active clients only, sorted by most recently updated. Archived clients hidden by default behind a toggle. **[REVIEW FIX]** Above 50 clients, the list switches to paginated (or virtualized/infinite-scroll) rendering rather than loading the full unbounded set. This threshold is a stated requirement, not a silent deferral. |
| CLI-04 | Soft delete client | Sets `archivedAt` timestamp. Client no longer selectable when creating new projects. Existing projects linked to this client are flagged with a visible "Client archived" badge; project data is untouched. **[REVIEW FIX]** Archiving a client does not affect linked projects' status or availability, and no warning is shown for active (e.g., `IN_PROGRESS`) projects under an archived client. This is an intentional design decision, stated here explicitly: client archiving is a filing action, not a project-blocking action. |
| CLI-05 | Restore client | User can un-archive a client (clears `archivedAt`). This is a v1-in-scope action since soft delete implies reversibility. |
| CLI-06 | View client detail | Shows client info plus a list of all projects (active and archived) linked to that client. |

### 5.3 Project Management

| ID | Requirement | Detail |
|---|---|---|
| PRJ-01 | Create project | Fields: title (required), client (optional, dropdown of active clients + "No client"), status (default "Not Started"), description (optional), start date (optional), due date (optional). |
| PRJ-02 | Status field | Enum: `NOT_STARTED`, `IN_PROGRESS`, `DONE`, `ARCHIVED`. Status changes are user-driven only; no automation in v1. |
| PRJ-03 | Edit project | All fields editable. Changing status is a single-field update, not a workflow with required transitions (any status can move to any other status — deliberately not enforced; see Section 10 for the associated `completedAt` timestamp fix). |
| PRJ-04 | Delete project | Hard delete, with confirmation. **[REVIEW FIX]** Given that project soft-delete vs. hard-delete is still an open question (Section 14) and the inconsistency with client soft-delete is a flagged risk (Section 9), the confirmation for project deletion is upgraded from a generic modal to a typed confirmation requiring the user to type the project's exact title, matching the rigor already used for account deletion (AUTH-05) and matching CLI's reversibility bar until Section 14 is resolved. |
| PRJ-05 | List projects (dashboard) | Default workspace home view. Shows all projects across all clients, filterable by status and by client, sorted by most recently updated by default. **[REVIEW FIX]** Above 50 projects, switches to paginated/virtualized rendering (same threshold and rationale as CLI-03). |
| PRJ-06 | View project detail | Shows project fields, linked client (if any), time entries (Section 5.4), and payment status (Section 5.5). |

### 5.4 Time Tracking (proposed default scope — see Section 8)

| ID | Requirement | Detail |
|---|---|---|
| TIME-01 | Add time entry | Fields: project (required, implicit from context), date (default today), duration in minutes (required, integer), note (optional). **[REVIEW FIX]** Minutes must be a positive integer, with a maximum of 1440 per entry (24 hours). This is validated server-side in the Server Action before write — not only via client-side form constraints — so a direct/malformed request cannot bypass the check. |
| TIME-02 | Edit/delete time entry | Freelancer can edit or delete any of their own entries. No approval workflow (single user). Same server-side validation from TIME-01 applies to edits. |
| TIME-03 | Project time total | Project detail view shows sum of all logged minutes, displayed as hours:minutes. |
| TIME-04 | No timer/stopwatch | v1 is manual entry only. No live timer UI (ASSUMPTION ADDED: reduces scope). |

### 5.5 Payment Tracking (proposed default scope — see Section 8)

| ID | Requirement | Detail |
|---|---|---|
| PAY-01 | Add payment record | Fields: project (required), amount (required, decimal, single currency per Section 8), status (`PENDING`, `PAID`), **[REVIEW FIX]** `dueDate` (default today; the date this payment is expected) and `paidDate` (null until the record is marked paid). This replaces the prior single overloaded `date` field, which conflated "due date" and "paid date" behind a status flag and risked stale/ambiguous values feeding the dashboard's "total outstanding" figure. |
| PAY-02 | Edit/delete payment record | Freelancer can edit or delete their own payment records. **[REVIEW FIX]** When a payment's status is changed from `PENDING` to `PAID`, `paidDate` is set automatically to today (editable by the user afterward); when changed back from `PAID` to `PENDING`, `paidDate` is cleared. |
| PAY-03 | Project payment summary | Project detail shows total pending and total paid, summed from payment records on that project. **[REVIEW FIX]** "Total outstanding" (used here and in DASH-01) is calculated as `SUM(amount) WHERE status = PENDING`, independent of any date field — removing the prior date-based ambiguity. |
| PAY-04 | No invoicing | No PDF generation, no invoice numbering, no sending to client. This is a payment status ledger only, not an invoicing system. |

### 5.6 Workspace / Dashboard

| ID | Requirement | Detail |
|---|---|---|
| DASH-01 | Home dashboard | Shows: count of active projects by status, list of projects updated in last 7 days, total outstanding (pending) payments across all projects (per the PAY-03 fix above). **[REVIEW FIX]** "Updated in last 7 days" is explicitly defined as filtering on `Project.updatedAt`. This means trivial edits (e.g., fixing a typo in the description) will surface here alongside substantive changes. This is a known, accepted v1 limitation — documented here rather than silently assumed — and may be refined in v2 with more granular change tracking. Projects with no linked client ("No client") are included normally in all counts; this is not treated as an edge case. |
| DASH-02 | Empty state | New account with zero projects shows a single "Create your first project" CTA. This is the activation trigger for the success metric in Section 11. |

## 6. AI Processing Pipeline

None in v1. This product has no AI-driven feature in its confirmed or proposed scope — no auto-categorization, no NLP on notes, no generated summaries. Every field in Sections 5.2–5.5 is directly user-entered. This section is intentionally kept (rather than deleted) to make explicit that no AI feature was silently dropped from an earlier template.

## 7. Technical Requirements

### 7.1 Stack (locked)
- Next.js (App Router, ASSUMPTION ADDED).
- TypeScript, strict mode enabled.
- Prisma ORM.
- PostgreSQL.

### 7.2 Architecture
- Single Next.js monolith: API routes (or Server Actions) handle both UI rendering and data mutations. No separate backend service.
- Server Actions used for all mutations (create/update/delete). ASSUMPTION ADDED.
- Database access exclusively through Prisma Client; no raw SQL except for indexes/migrations.

### 7.3 Data Isolation

**[REVIEW FIX — highest-severity fix in this revision]**

- Every table storing user data includes a `userId` foreign key. **[REVIEW FIX]** This now explicitly includes `TimeEntry` and `Payment`, which previously only had `projectId` and relied on a join through `Project` to determine ownership. `userId` is denormalized directly onto `TimeEntry` and `Payment` (see Section 10 schema) so that isolation can be enforced by a direct column filter on every model, not a join-dependent one.
- **[REVIEW FIX]** Isolation is enforced via a **Prisma Client Extension** that automatically injects a `WHERE userId = <session userId>` clause into every query against `Client`, `Project`, `TimeEntry`, and `Payment`, rather than relying solely on developer discipline to call a shared query helper on every call site. The extension is the single point of enforcement; direct, unscoped Prisma Client usage against these four models is disallowed by lint rule / code review checklist.
- **[REVIEW FIX]** A cross-user isolation integration test suite (asserting that no query against any of the four models can return another user's rows) is a **required, merge-blocking CI check** — not an aspirational test suite mentioned only as a risk mitigation. A pull request cannot merge if this suite fails or is skipped.
- Row-level security (RLS) at the database layer remains out of scope for v1 given the small, low-risk scale target; the Client Extension + mandatory CI gate is the stated v1-appropriate alternative.

### 7.4 Environments
- Single production environment plus local dev. No staging environment required at this scale (ASSUMPTION ADDED).
- Database migrations via `prisma migrate deploy` run as a pre-deploy step.

### 7.5 Hosting
- ASSUMPTION ADDED: Vercel for the Next.js app and a managed Postgres provider (e.g. Neon or Supabase Postgres).

### 7.6 Performance
- Standard target: server responses under 500ms for all CRUD operations under normal load (ASSUMPTION ADDED default). **[REVIEW FIX]** This target is now paired with a monitoring requirement — see Section 13, Phase 7 — since an SLA with no observability mechanism is not verifiable. Minimum viable implementation: request-duration logging via a lightweight APM (e.g., Vercel Analytics) or logging middleware, with basic alerting on sustained threshold breaches.

### 7.7 Security
- Passwords hashed with bcrypt (cost factor 12).
- All routes except signup/login/landing require an authenticated session.
- CSRF protection via NextAuth defaults.
- Rate limiting on login and password reset endpoints (ASSUMPTION ADDED: 5 attempts per 15 minutes per IP).

## 8. Business Model

Not specified by user. Proposed default: **free, no monetization in v1.** Flagged as an assumption, not a confirmed decision.

Rationale: the confirmed success metrics (activation, weekly active usage) are usage metrics, not revenue metrics, implying v1 is a pre-monetization validation stage.

Also not specified: exact feature scope for "information related to freelance work." Proposed default v1 scope, flagged as assumption:

| Feature | In v1? | Reasoning |
|---|---|---|
| Time tracking (manual entry) | Yes | Low build cost, directly supports the freelancer workflow of knowing hours per project. |
| Payment status tracking (ledger only) | Yes | Freelancers need to know what's owed; low complexity without invoicing. |
| Invoicing (PDF generation, sending) | No | High complexity (numbering, templates, delivery); defer to v2. |
| Contract storage | No | Requires file storage infra and versioning; no confirmed need stated. |
| Client-facing anything | No | Explicitly excluded by confirmed non-goals. |

**[REVIEW FIX]** Because this section is explicitly unconfirmed, and Section 13's Phase 0 gates all engineering on its sign-off, Section 10's schema is now labeled as *proposed* rather than committed (see the note at the top of Section 10). The `TimeEntry` and `Payment` models in particular are flagged as the parts of the schema most likely to change if Section 8's proposed scope is revised, since they exist only because of this proposed (not confirmed) default.

If the user has an actual monetization plan or a different feature scope in mind, Section 8 and the tables in 5.4/5.5 should be revised before engineering starts, since they affect the data model in Section 10.

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Feature scope (Section 8) is an assumption, not confirmed | Wasted engineering effort if wrong | Get explicit sign-off on Section 8 before Phase 1 starts (see Section 14). **[REVIEW FIX]** Phase 0 now has a timeout/escalation clause (Section 13) so this cannot block indefinitely. |
| **[REVIEW FIX]** Soft-delete-only on clients but hard-delete on projects creates inconsistent mental model for users | User confusion, potential permanent data loss | **This is a currently-open question, not a closed decision (see Section 14).** Until resolved, project deletion requires a typed-title confirmation (PRJ-04) rather than a generic modal, raising the bar to match the risk. Revisit fully in v2, or sooner if user feedback or the Section 14 decision indicates project soft-delete is needed. |
| **[REVIEW FIX]** No RLS; isolation enforced only at application layer | A missed `userId` filter in one query is a full data leak of client financial data | Enforced via a Prisma Client Extension that auto-injects `userId` scoping on all four user-data models (Section 7.3), plus a merge-blocking CI integration test suite asserting cross-user isolation. This is now a required gate, not a best-effort test suite. |
| Single currency in v1 | Blocks any freelancer with international clients in different currencies | Explicitly out of scope; document limitation in user-facing copy on payment fields. |
| No timer feature | Users who want live time tracking may churn to competitors | Acceptable v1 trade-off; monitor usage of manual time entry to gauge demand for v2. |
| **[REVIEW FIX — new risk]** Success metrics (Section 11) originally measured only account/project creation, not usage of the actual differentiating features (time/payment tracking) | Could ship and declare "success" while the core value proposition goes unused | Added secondary activation metric tracking time-entry/payment-record usage within 7 days (Section 11). |

## 10. Prisma Data Model

> **[REVIEW FIX]** This schema is **proposed, contingent on Phase 0 sign-off** on Section 8's business model and feature scope. The `TimeEntry` and `Payment` models are the parts most likely to change if that scope is revised, since time tracking and payment ledger are themselves proposed (not confirmed) defaults.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum ProjectStatus {
  NOT_STARTED
  IN_PROGRESS
  DONE
  ARCHIVED
}

enum PaymentStatus {
  PENDING
  PAID
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String?   // null if OAuth-only account
  emailVerified DateTime?
  oauthProvider String?   // e.g. "google"
  oauthId       String?
  deactivatedAt DateTime? // [REVIEW FIX] set when user requests deletion; grace period start
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  clients  Client[]
  projects Project[]

  @@index([email])
}

model Client {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  name       String
  email      String?
  notes      String?
  archivedAt DateTime? // soft delete marker
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt

  projects Project[]

  @@index([userId])
  @@index([userId, archivedAt])
}

model Project {
  id          String        @id @default(cuid())
  userId      String
  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  clientId    String?
  client      Client?       @relation(fields: [clientId], references: [id], onDelete: SetNull)
  title       String
  description String?
  status      ProjectStatus @default(NOT_STARTED)
  startDate   DateTime?
  dueDate     DateTime?
  completedAt DateTime?     // [REVIEW FIX] set when status transitions to DONE; cleared if status reverts
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  timeEntries TimeEntry[]
  payments    Payment[]

  @@index([userId])
  @@index([userId, status])
  @@index([clientId])
}

model TimeEntry {
  id         String   @id @default(cuid())
  userId     String   // [REVIEW FIX] denormalized for direct isolation filtering
  projectId  String
  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  date       DateTime
  minutes    Int      // [REVIEW FIX] app-layer validation: positive integer, max 1440
  note       String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([projectId])
  @@index([userId])
}

model Payment {
  id        String        @id @default(cuid())
  userId    String        // [REVIEW FIX] denormalized for direct isolation filtering
  projectId String
  project   Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  amount    Decimal       @db.Decimal(12, 2)
  status    PaymentStatus @default(PENDING)
  dueDate   DateTime      // [REVIEW FIX] replaces overloaded `date`; set on creation
  paidDate  DateTime?     // [REVIEW FIX] set automatically when status -> PAID; cleared if reverted
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt

  @@index([projectId])
  @@index([userId])
}
```

Notes on the model:
- `Client.archivedAt` implements the confirmed soft-delete requirement. Application queries for "active clients" filter `WHERE archivedAt IS NULL`.
- `Project.clientId` is nullable (`onDelete: SetNull` is defensive; clients are never hard-deleted).
- `Project.completedAt` **[REVIEW FIX]** is set when `status` transitions to `DONE` and cleared if status is later changed away from `DONE`. This gives the dashboard a meaningful "when was this actually finished" signal distinct from `updatedAt`, which changes on any edit.
- `Project` has no `archivedAt` — it uses the `ARCHIVED` status enum value instead. A project's "Client archived" badge (CLI-04) is computed at read time by checking `project.client?.archivedAt`, not stored redundantly.
- `Payment.amount` uses `Decimal` to avoid floating-point currency errors.
- **[REVIEW FIX]** `Payment.dueDate` / `Payment.paidDate` replace the prior single overloaded `date` field. `dueDate` is set on creation; `paidDate` is set automatically when `status` moves to `PAID` and cleared if reverted to `PENDING`.
- **[REVIEW FIX]** `TimeEntry.userId` and `Payment.userId` are denormalized directly onto these models (rather than requiring a join through `Project`) so the Section 7.3 Prisma Client Extension can enforce isolation with a direct column filter on every model, closing the join-based leak risk identified in review.
- **[REVIEW FIX]** `User.deactivatedAt` supports the AUTH-05 grace-period flow: set when the user requests deletion, cleared on reactivation, and checked by a scheduled job that performs the hard cascade-delete only after 30 days with no reactivation.
- No `Currency` field exists anywhere, per the confirmed single-currency constraint. Currency, if ever needed, would be a v2 addition at the `User` level, not per-payment.

## 11. Success Metrics

| Metric | Definition | Target (v1 launch) |
|---|---|---|
| Activation rate | % of signed-up users who create at least 1 project within 7 days of signup | ASSUMPTION ADDED target: 50% (placeholder). |
| **[REVIEW FIX — new metric]** Ledger activation rate | % of users who log at least 1 time entry OR 1 payment record within 7 days of signup | ASSUMPTION ADDED target: 30% (placeholder). Added because "created 1 project" alone does not test usage of the actual differentiating features (time/payment tracking) claimed in Section 2's problem statement. |
| Weekly active usage | % of activated users who perform at least 1 create/update action (project, time entry, or payment) in a given week | **[REVIEW FIX]** Redefined for methodological clarity: measured as a **rolling 7-day window from each user's own activation date** (not a shared calendar week), evaluated at the 1-week, 4-week, and 12-week marks post-activation. This produces a real per-cohort retention curve instead of a single ambiguous aggregate number. ASSUMPTION ADDED target: 30% at the 1-week mark (placeholder). |
| Time-to-first-project | Median minutes from signup to first project created | Tracked, no target set (diagnostic metric for onboarding friction). |

## 12. Assumptions

Full list of assumptions added in this document, consolidated for review:

1. Email verification required before login.
2. OAuth provider is Google. **[REVIEW FIX]** Auto-linking additionally requires the provider's `email_verified` claim to be `true`.
3. NextAuth used for authentication/session management.
4. Project deletion is a hard delete (only clients are soft-deleted). **[REVIEW FIX]** This remains an open question (Section 14); in the interim, hard delete requires a typed-title confirmation rather than a generic modal.
5. No live timer feature; time entry is manual only.
6. App Router used (not Pages Router).
7. Server Actions used for mutations instead of REST API routes.
8. **[REVIEW FIX]** Isolation enforced via a Prisma Client Extension with denormalized `userId` on all four data models, plus a merge-blocking CI isolation test suite — not solely a shared query helper.
9. No staging environment in v1.
10. Hosting: Vercel + managed Postgres (e.g. Neon/Supabase).
11. Default performance target: <500ms for CRUD operations. **[REVIEW FIX]** Paired with a request-duration monitoring/alerting requirement (Phase 7).
12. Rate limiting: 5 attempts / 15 minutes on login and password reset.
13. Business model: free, no monetization in v1 (explicitly flagged as unconfirmed in Section 8).
14. Feature scope: time tracking + payment ledger in, invoicing + contracts out (explicitly flagged as unconfirmed in Section 8; Section 10 schema labeled proposed accordingly).
15. Activation and weekly-active-usage numeric targets are placeholders pending business input.
16. **[REVIEW FIX — new]** Account deletion is a 30-day soft-deactivation followed by scheduled hard delete, not immediate hard delete.
17. **[REVIEW FIX — new]** List views (clients, projects) paginate/virtualize above 50 items.
18. **[REVIEW FIX — new]** Phase 0 sign-off has a default-decision timeout rather than blocking indefinitely.

## 13. Phased Roadmap

| Phase | Scope | Depends on |
|---|---|---|
| Phase 0: Confirm scope | Get explicit sign-off on Section 8 (business model + feature scope) before any engineering starts. **[REVIEW FIX]** If no sign-off is received within **10 business days**, the Product Lead makes the default call per Section 8's proposed defaults and documents the decision retroactively, so the roadmap is not blocked indefinitely. | User decision (time-boxed) |
| Phase 1: Auth + account | AUTH-01 through AUTH-05 (including the grace-period delete flow and OAuth email-verification check) | Phase 0 |
| Phase 2: Client management | CLI-01 through CLI-06 (including the 50-item pagination threshold) | Phase 1 |
| Phase 3: Project management | PRJ-01 through PRJ-06 (including `completedAt` tracking and typed-confirmation delete) | Phase 2 |
| Phase 4: Time tracking | TIME-01 through TIME-04 (including server-side minute validation) | Phase 3 |
| Phase 5: Payment tracking | PAY-01 through PAY-04 (including the `dueDate`/`paidDate` split) | Phase 3 (can run parallel to Phase 4) |
| Phase 6: Dashboard | DASH-01, DASH-02 | Phases 3–5 |
| Phase 7: Launch hardening | Rate limiting, error monitoring, **[REVIEW FIX] performance/latency monitoring and alerting**, backup verification, cross-user isolation test suite as a **merge-blocking CI gate** (Section 7.3/9) | All prior phases |

## 14. Open Questions

- Confirm or revise the proposed v1 feature scope in Section 8 (time tracking and payment ledger in; invoicing and contracts out).
- Confirm or revise the proposed business model (free, no monetization) in Section 8.
- Confirm OAuth provider choice (Google assumed) — is a different provider required?
- Should project deletion also be soft-delete, matching client behavior, or is the interim typed-confirmation hard delete (**[REVIEW FIX]**, Section 5.3/PRJ-04) acceptable long-term?
- What numeric targets should replace the placeholder activation (50%), ledger-activation (30%), and weekly-active (30%) percentages in Section 11?
- Is a staging environment actually required despite the small scale target, e.g. for compliance or client-demo purposes?
- **[REVIEW FIX — new]** Should the optional data-export-before-deletion step in AUTH-05 be mandatory rather than optional?

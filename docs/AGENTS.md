# **AGENTS.md**

## **1\. What is this project?**

Build the **Freelance Project Tracker**, a single-user SaaS workspace for solo freelancers to manage their own clients, projects, time entries, and payment-status records.

The product is **not a marketplace**. Do not build freelancer discovery, client matching, bidding, client portals, team collaboration, delegated access, or third-party viewer access.

The current target is **v1**. The **PRD is the source of truth for product requirements, scope, business rules, data behavior, and phased delivery**.

The intended v1 scope is client management, project management, manual time tracking, payment-status tracking, and the dashboard, subject to the PRD's Phase 0 scope-signoff gate.

---

## **2\. What is locked?**

The following choices are locked. **Do not replace, swap, "upgrade," or introduce alternatives without explicit authorization.**

### **Application stack**

* Use **Next.js with the App Router**.  
* Use **TypeScript with strict mode enabled**.  
* Use **Prisma ORM**.  
* Use **PostgreSQL**.  
* Use **NextAuth** for authentication and session management.  
* Use **Google OAuth** as the OAuth provider.  
* Use **Vercel** as the application hosting target.  
* Use a **managed PostgreSQL provider** for production.  
* Use **Flutterwave as the payment provider**.

### **Flutterwave payment rule**

**Flutterwave is the only approved payment provider for this project.**

When the approved product scope requires actual payment processing, integrate with Flutterwave rather than introducing another payment provider.

* Never replace Flutterwave with Stripe, Paystack, PayPal, Razorpay, or another payment provider.  
* Never introduce a second payment provider as a fallback or alternative.  
* Keep Flutterwave-specific integration code isolated behind a clear payment-service boundary so the rest of the application does not depend directly on Flutterwave APIs.  
* Never expose Flutterwave secret keys or private credentials to the browser.  
* Keep payment-provider credentials in server-side environment variables/secrets.  
* Treat payment-provider webhooks as untrusted input and verify their authenticity before acting on them.  
* Never mark a payment as successfully processed solely because a client-side request says it succeeded.  
* Persist only the minimum Flutterwave transaction/reference information required by the approved product scope.  
* Do not build Flutterwave functionality merely because the provider is locked. **The provider choice does not expand the approved v1 feature scope.**  
* The PRD's v1 payment feature is a **payment-status ledger**, not an invoicing or payment-collection system, unless the approved product scope is explicitly changed.

### **Architecture**

* Keep the application as a **single Next.js monolith**.  
* Do not create a separate backend service.  
* Use **Server Actions for all create/update/delete mutations**.  
* Access PostgreSQL exclusively through **Prisma Client**.  
* Do not use raw SQL except where required for indexes or migrations.

### **Data isolation**

Every user-owned data model must have a direct `userId` ownership field.

This includes:

* `Client`  
* `Project`  
* `TimeEntry`  
* `Payment`

Enforce ownership through a **Prisma Client Extension** that automatically scopes queries to the authenticated session's `userId`.

The Prisma Client Extension is the single application-level enforcement point.

* Never rely solely on developers remembering to add ownership filters.  
* Never issue unscoped Prisma queries against protected user-data models.  
* The cross-user isolation integration test suite is **merge-blocking in CI**.  
* Never skip, disable, or weaken the isolation tests to make a build pass.

### **Database baseline**

When Phase 0 approves the proposed v1 feature scope, use the PRD's proposed Prisma schema as the baseline.

Preserve these decisions:

* `Client.archivedAt` implements client soft deletion.  
* `Project.clientId` is nullable and uses `onDelete: SetNull`.  
* Deleting/archiving a client must not destroy its projects.  
* `Project.completedAt` is set when status becomes `DONE` and cleared when status changes away from `DONE`.  
* Projects use `ARCHIVED` as a status rather than `archivedAt`.  
* `Payment.amount` uses fixed-precision `Decimal`.  
* `Payment.dueDate` and `Payment.paidDate` are separate fields.  
* No `Currency` field exists in v1.  
* `User.deactivatedAt` supports the 30-day account-deletion grace period.  
* `TimeEntry.userId` and `Payment.userId` are stored directly for isolation enforcement.

### **Environments and deployment**

* Support local development and one production environment.  
* Do not create a staging environment unless explicitly approved.  
* Run database migrations with `prisma migrate deploy` as a pre-deployment step.  
* Use LTS-supported runtime and stable tooling.

---

## **3\. What must never happen?**

**Breaking any rule in this section means the task has failed, even if the code runs.**

### **Scope**

* Never build functionality outside the approved phase.  
* Never implement client-facing login, portals, or notifications in v1. `[PRD §3]`  
* Never implement a marketplace, discovery, matching, or bidding system. `[PRD §3]`  
* Never implement team accounts, shared workspaces, or role-based permissions in v1. `[PRD §3]`  
* Never implement shared or delegated third-party access, including read-only access. `[PRD §3]`  
* Never implement multi-currency or tax computation in v1. `[PRD §3]`  
* Never implement invoicing, invoice PDFs, invoice numbering, or sending invoices. `[PRD §3; PAY-04]`  
* Never implement contract storage or e-signatures. `[PRD §3]`  
* Never implement integrations outside the approved scope. `[PRD §3]`  
* Never build a mobile application in v1. `[PRD §3]`  
* Never add AI processing or AI-driven product features. `[PRD §6]`

### **Authentication and security**

* Always require passwords to contain at least 8 characters. `[AUTH-01]`  
* Always hash passwords with bcrypt cost factor 12\. `[AUTH-01; PRD §7.7]`  
* Never store raw passwords. `[AUTH-01]`  
* Always require email verification before login. `[PRD §12]`  
* Only auto-link Google OAuth accounts when Google's `email_verified` claim is `true`. `[AUTH-02]`  
* Never auto-link an OAuth account when `email_verified` is false or absent. `[AUTH-02]`  
* Require the existing password-reset verification flow when OAuth email verification is insufficient for account linking. `[AUTH-02]`  
* Password-reset tokens must expire after one hour. `[AUTH-03]`  
* Use JWT sessions through NextAuth. `[AUTH-04]`  
* Sessions must expire after 30 days of inactivity. `[AUTH-04]`  
* Require authentication on every route except signup, login, and landing. `[PRD §7.7]`  
* Never disable or bypass NextAuth CSRF protection. `[PRD §7.7]`  
* Rate-limit login and password-reset attempts to 5 attempts per 15 minutes per IP. `[PRD §7.7]`

### **Account deletion**

* Never immediately hard-delete an account when deletion is requested. `[AUTH-05]`  
* Require the user to type exactly `DELETE` to confirm account deletion. `[AUTH-05]`  
* Immediately deactivate the account after deletion is requested. `[AUTH-05]`  
* Block login while the account is deactivated. `[AUTH-05]`  
* Retain all account data during the 30-day grace period. `[AUTH-05]`  
* Allow reactivation during the grace period. `[AUTH-05]`  
* After 30 days without reactivation, use a scheduled job to hard-delete the user and owned records. `[AUTH-05]`

### **Data isolation**

* Every user-owned data row must have a direct `userId`. `[PRD §7.3]`  
* Always enforce ownership through the Prisma Client Extension. `[PRD §7.3]`  
* Never rely solely on developer discipline or shared helper functions. `[PRD §7.3]`  
* Never allow one user's query to return another user's records. `[PRD §7.3]`  
* Never skip the cross-user isolation integration test suite. `[PRD §7.3]`  
* Never merge code while the isolation suite fails or is skipped. `[PRD §7.3]`

### **Client management**

* Only active clients may be selected when creating new projects. `[CLI-04]`  
* Archive clients with `archivedAt`; never hard-delete them. `[CLI-04]`  
* Never modify or destroy project data when a client is archived. `[CLI-04]`  
* Never change a project's status because its client was archived. `[CLI-04]`  
* Always show a `Client archived` badge for projects linked to archived clients. `[CLI-04]`  
* Never show a warning merely because an active project belongs to an archived client. `[CLI-04]`  
* Always allow archived clients to be restored. `[CLI-05]`  
* Hide archived clients by default. `[CLI-03]`  
* Switch client lists to pagination, virtualization, or infinite scrolling above 50 clients. `[CLI-03]`

### **Project management**

* Only use `NOT_STARTED`, `IN_PROGRESS`, `DONE`, and `ARCHIVED` project statuses. `[PRJ-02]`  
* Default new projects to `NOT_STARTED`. `[PRJ-01]`  
* Never automatically change project status. `[PRJ-02]`  
* Never impose mandatory status-transition workflows. `[PRJ-03]`  
* Set `completedAt` when a project changes to `DONE`. `[PRD §10]`  
* Clear `completedAt` when a project changes away from `DONE`. `[PRD §10]`  
* Require the user to type the exact project title before hard deletion. `[PRJ-04]`  
* Never replace typed-title confirmation with a generic delete modal. `[PRJ-04]`  
* Never treat a project without a client as invalid. `[DASH-01]`  
* Switch project lists to pagination, virtualization, or infinite scrolling above 50 projects. `[PRJ-05]`

### **Time tracking**

* Only accept positive integer minute values. `[TIME-01]`  
* Never accept more than 1,440 minutes in one entry. `[TIME-01]`  
* Always validate time-entry duration server-side before writing. `[TIME-01]`  
* Never rely only on client-side validation. `[TIME-01]`  
* Apply the same validation to edits. `[TIME-02]`  
* Never introduce an approval workflow. `[TIME-02]`  
* Never introduce a timer or stopwatch in v1. `[TIME-04]`

### **Payment and Flutterwave rules**

* Treat v1 payment tracking as a **ledger**, not an invoicing system. `[PAY-04]`  
* Never generate invoices, invoice numbers, PDFs, or client invoice messages. `[PAY-04]`  
* Store money using fixed-precision `Decimal`; never persist money using floating-point numbers. `[PRD §10]`  
* Never add multi-currency payment support in v1. `[PRD §3; §10]`  
* Only use `PENDING` and `PAID` payment statuses. `[PAY-01]`  
* Always store the expected payment date in `dueDate`. `[PAY-01]`  
* Never overload a date field to mean both due and paid dates. `[PAY-01]`  
* Set `dueDate` when a payment record is created. `[PAY-01]`  
* Keep `paidDate` null until a payment becomes `PAID`. `[PAY-01]`  
* Set `paidDate` automatically when status changes from `PENDING` to `PAID`. `[PAY-02]`  
* Clear `paidDate` when status changes from `PAID` back to `PENDING`. `[PAY-02]`  
* Calculate outstanding payments as `SUM(amount) WHERE status = PENDING`. `[PAY-03]`  
* Never calculate outstanding balances from date fields. `[PAY-03]`  
* Only permit users to edit or delete their own payment records. `[PAY-02]`  
* **Never replace Flutterwave with another payment provider.**  
* **Never expose Flutterwave secret credentials client-side.**  
* **Never trust an unverified Flutterwave webhook or client-side payment result.**  
* **Never add payment collection or checkout to v1 unless that functionality has been explicitly approved as a scope change.**

### **Dashboard**

* Define "updated in last 7 days" using `Project.updatedAt`. `[DASH-01]`  
* Never substitute `completedAt` for `updatedAt` in that dashboard list. `[DASH-01]`  
* Include projects with no linked client in all applicable dashboard counts. `[DASH-01]`  
* Calculate total outstanding using pending payment records. `[DASH-01; PAY-03]`  
* Show a single `Create your first project` CTA for a new account with zero projects. `[DASH-02]`

### **Performance and operations**

* Target CRUD responses below 500ms under normal load. `[PRD §7.6]`  
* Maintain request-duration monitoring. `[PRD §7.6]`  
* Provide basic alerting for sustained threshold breaches. `[PRD §7.6]`  
* Verify backups during launch hardening. `[Phase 7]`

---

## **4\. How is the work arranged?**

Use this project structure:

/  
├── AGENTS.md  
├── package.json  
├── tsconfig.json  
├── next.config.\*  
├── prisma/  
│   ├── schema.prisma  
│   ├── migrations/  
│   └── seed.\*  
├── public/  
├── src/  
│   ├── app/  
│   │   ├── (auth)/  
│   │   ├── (dashboard)/  
│   │   ├── api/  
│   │   ├── layout.tsx  
│   │   └── page.tsx  
│   ├── components/  
│   │   ├── ui/  
│   │   ├── clients/  
│   │   ├── projects/  
│   │   ├── time/  
│   │   ├── payments/  
│   │   └── dashboard/  
│   ├── server/  
│   │   ├── actions/  
│   │   │   ├── auth/  
│   │   │   ├── clients/  
│   │   │   ├── projects/  
│   │   │   ├── time/  
│   │   │   └── payments/  
│   │   └── jobs/  
│   ├── lib/  
│   │   ├── auth/  
│   │   ├── db/  
│   │   ├── validation/  
│   │   ├── security/  
│   │   ├── payments/  
│   │   │   └── flutterwave/  
│   │   └── monitoring/  
│   ├── types/  
│   └── config/  
├── tests/  
│   ├── unit/  
│   ├── integration/  
│   └── e2e/  
└── docs/

Keep Flutterwave-specific code inside `src/lib/payments/flutterwave/`.

Do not spread Flutterwave API calls throughout Server Actions or React components. The application should communicate with a small internal payment-service boundary rather than coupling every feature directly to the provider.

Follow the PRD's phases in order:

1. Phase 0 — Confirm scope  
2. Phase 1 — Auth \+ account  
3. Phase 2 — Client management  
4. Phase 3 — Project management  
5. Phase 4 — Time tracking  
6. Phase 5 — Payment tracking  
7. Phase 6 — Dashboard  
8. Phase 7 — Launch hardening

Never implement later-phase functionality early.

---

## **5\. How should the code look?**

Write code that is **clean, readable, modern, maintainable, and compatible with LTS-supported tooling**.

* Use strict TypeScript.  
* Prefer small, focused functions.  
* Use descriptive names.  
* Avoid clever abstractions.  
* Keep business rules explicit.  
* Validate untrusted input at server boundaries.  
* Keep authorization and ownership checks server-side.  
* Never trust client-provided `userId`.  
* Derive the authenticated user from the server session.  
* Avoid unnecessary dependencies.  
* Do not introduce speculative frameworks.  
* Keep business logic out of presentational components.  
* Keep database access centralized.  
* Keep payment-provider logic isolated.  
* Never expose provider secrets to browser code.  
* Keep expected errors explicit and user-readable.  
* Do not expose internal errors, secrets, or database details.  
* Do not use `any` to bypass the type system without a documented reason.  
* Use transactions where multiple related writes must remain consistent.  
* Keep money calculations in fixed precision.  
* Keep `dueDate`, `paidDate`, `completedAt`, `createdAt`, and `updatedAt` semantically distinct.

Test security-sensitive and business-critical behavior, especially:

* Authentication.  
* OAuth account linking.  
* Account deletion/reactivation.  
* Client archival/restoration.  
* Project status transitions.  
* Typed project deletion.  
* Time-entry boundaries.  
* Payment status transitions.  
* Payment totals.  
* Flutterwave integration behavior, where payment processing is approved.  
* Dashboard calculations.  
* Pagination thresholds.  
* Cross-user isolation.

---

## **6\. What counts as done?**

A task is done only when:

* The applicable PRD requirements are implemented.  
* Every applicable rule in this `AGENTS.md` is satisfied.  
* The implementation belongs to the current phase.  
* No unauthorized feature has been introduced.  
* Relevant tests pass.  
* Cross-user isolation tests pass.  
* TypeScript strict checks pass.  
* Lint checks pass.  
* The application builds with **zero errors**.  
* Required database migrations exist and work.  
* No security or business-rule validation has been bypassed.  
* No locked technology or service has been replaced.  
* Flutterwave integration, when applicable, is server-side and securely implemented.  
* No unresolved requirement has been silently invented or reinterpreted.

At the end of every task, provide a checklist containing:

* PRD requirement IDs completed.  
* `AGENTS.md` rules satisfied.  
* Tests executed and results.  
* TypeScript/lint/build results.  
* Migration status, if applicable.  
* Later-phase requirements intentionally left untouched.  
* Remaining blockers or uncertainties.

Never call a task complete when the build fails.

---

## **7\. What does the agent do when unsure?**

When unsure:

1. Do not introduce a new feature.  
2. Do not expand the current phase.  
3. Do not invent a business rule.  
4. Do not invent a permission.  
5. Do not invent a database field merely because it seems useful.  
6. Do not invent a new service.  
7. Do not replace a locked technology.  
8. Do not replace Flutterwave with another payment provider.  
9. Do not create a separate backend or microservice.  
10. Do not bypass the Prisma Client Extension.  
11. Do not weaken validation or security.  
12. Do not silently resolve an open PRD question as though it were settled.  
13. Do not implement later-phase functionality early.  
14. Do not introduce speculative abstractions.  
15. Do not inject spaghetti code to work around uncertainty.  
16. Prefer the smallest implementation that satisfies the explicit requirement.  
17. If requirements conflict, identify the conflict rather than silently choosing a side.  
18. If clarification is genuinely required, ask for the smallest decision necessary to continue.

**When uncertain, preserve the existing scope and architecture. Do not invent.**

A feature that works but violates this file is **not complete**.

Correctness means:

**PRD requirement \+ correct phase \+ locked architecture \+ business-rule compliance \+ security/data isolation \+ tests \+ successful build.**


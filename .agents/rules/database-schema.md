---
trigger: always_on
---

# Database Schema Rules

## Purpose

Protect data integrity, user isolation, and the domain relationships defined by the PRD.

## Rules

1. Use Prisma as the application's database access layer.

2. Use PostgreSQL as the database.

3. Every user-owned data model must contain a direct `userId` ownership field.

4. The following user-owned models must remain directly isolated by `userId`:
   - Client
   - Project
   - TimeEntry
   - Payment

5. Do not rely only on relationships such as `Payment -> Project -> User` for application-level isolation. User-owned records must retain their direct ownership boundary.

6. Prisma Client Extensions must enforce automatic user scoping for user-owned models.

7. Direct unscoped Prisma access to user-owned data is prohibited.

8. Every query, mutation, update, delete, and relation operation must preserve the authenticated user's ownership boundary.

9. Do not use raw SQL for normal application data access. Raw SQL is restricted to indexes and migrations as defined by the architecture.

10. Preserve the existing relational delete behavior:
    - User deletion cascades to owned data.
    - Client deletion behavior must preserve project history.
    - Project deletion cascades to its project-owned time and payment records.
    - Project client relationships must not cause project data to be destroyed when a client is archived.

11. Keep `Client.archivedAt` as the client archival mechanism. Do not introduce a second client deletion mechanism without an explicit product decision.

12. Keep Project lifecycle state in `Project.status`. Do not introduce a separate project `archivedAt` field unless the product specification explicitly changes.

13. Keep `Project.completedAt` derived from the transition into and out of `DONE`.

14. Keep `Payment.amount` as a PostgreSQL Decimal-compatible value. Never use floating-point types for persisted monetary amounts.

15. Preserve the separation between `Payment.dueDate` and `Payment.paidDate`.

16. Do not add multi-currency fields or per-payment currency handling in v1.

17. Schema changes must be performed through Prisma migrations.

18. Never modify production schema manually when a migration is required.

19. Never delete, rewrite, or squash an existing migration that may already have been applied to an environment.

20. Before changing a destructive schema behavior, verify its effect on existing user data and explicitly surface any required product decision.

21. Cross-user isolation tests are merge-blocking. A schema or data-access change is incomplete if it can cause one user's records to become visible or mutable by another user.

22. Do not add database fields merely because a future feature might need them. Add schema fields only when required by the approved product or architecture.
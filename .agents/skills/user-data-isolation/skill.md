
### `.agents/skills/user-data-isolation/skill.md`

```markdown
---
name: user-data-isolation
description: Use for Client, Project, TimeEntry, Payment, userId, Prisma queries, Prisma mutations, Server Actions, ownership checks, relations, data access, or cross-user isolation tests.
---

# User Data Isolation

This skill teaches the ordered implementation and verification of user-owned data access. Its laws live in `database-schema.md` and `security.md`, with the architecture defined by the PRD and `AGENTS.md`.

## Procedure

1. Identify every user-owned model touched by the task:
   - `Client`
   - `Project`
   - `TimeEntry`
   - `Payment`

2. Obtain the authenticated user's `userId` on the server.
   - Never accept ownership from the client.
   - Never let a request parameter replace the session user's identity.

3. Use the application's scoped Prisma Client.
   - The Prisma Client Extension is the single ownership-enforcement point.
   - Do not introduce direct unscoped Prisma access.

4. Preserve direct ownership on every user-data model.
   - `Client.userId`
   - `Project.userId`
   - `TimeEntry.userId`
   - `Payment.userId`

5. When a record references another record, verify the ownership chain through the scoped models.
   - Do not authorize a `TimeEntry` or `Payment` mutation using `projectId` alone.
   - The target project and target record must remain inside the authenticated user's scope.

6. For create operations:
   - Derive ownership from the authenticated session.
   - Derive related records from scoped queries.
   - Never copy a client-supplied `userId` into the record.

7. For reads:
   - Query through the scoped Prisma Client.
   - Include relations only through ownership-safe queries.
   - Do not create a second manual ownership mechanism that can diverge from the extension.

8. For updates and deletes:
   - Resolve the target through the scoped Prisma Client.
   - Perform the mutation through the same ownership boundary.
   - Do not fetch globally and authorize later.

9. Keep database access inside Prisma.
   - Do not use raw SQL for application data access.
   - Raw SQL remains limited to indexes and migrations.

10. Add or update the cross-user isolation test whenever the change can affect data access.
    - Test each affected user-data model.
    - Assert that one user cannot read another user's records.
    - Assert that one user cannot mutate or delete another user's records where applicable.

11. Treat the isolation suite as a merge gate.
    - A failed or skipped isolation test means the task is not complete.

## Key Patterns

```ts
const session = await auth()

if (!session?.user?.id) {
  throw new Error("Unauthorized")
}

const db = getScopedPrisma(session.user.id)

const projects = await db.project.findMany({
  orderBy: { updatedAt: "desc" },
})
// Ownership comes from the session, not form input.
await db.timeEntry.create({
  data: {
    userId: session.user.id,
    projectId,
    date,
    minutes,
    note,
  },
})
// Resolve the target through the scoped client.
const payment = await db.payment.findUnique({
  where: { id: paymentId },
})

if (!payment) {
  throw new Error("Payment not found")
}

await db.payment.update({
  where: { id: payment.id },
  data: updateData,
})
// Isolation test shape
it("does not return another user's records", async () => {
  // Create records for user A and user B.
  // Query as user A.
  // Assert user B's rows are absent.
})
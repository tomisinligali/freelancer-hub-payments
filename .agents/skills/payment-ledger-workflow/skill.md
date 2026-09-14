
### `.agents/skills/payment-ledger-workflow/skill.md`

```markdown
---
name: payment-ledger-workflow
description: Use for Payment, payment records, PENDING, PAID, dueDate, paidDate, amount, Decimal, outstanding totals, paid totals, payment status changes, or payment-related project and dashboard work.
---

# Payment Ledger Workflow

This skill teaches the safe implementation sequence for payment-ledger operations. Its laws live in `money-billing.md`, with authorization requirements in `security.md` and payment requirements in the PRD and `AGENTS.md`.

## Procedure

1. Identify whether the task changes:
   - Payment creation
   - Payment editing
   - Payment deletion
   - Status transitions
   - `dueDate`
   - `paidDate`
   - Payment totals
   - Project payment summaries
   - Dashboard outstanding totals

2. Resolve the authenticated user's ownership scope before touching the payment.
   - Use the scoped Prisma Client.
   - Resolve the target project through that scope.
   - Never authorize by `projectId` alone.

3. For payment creation:
   - Require the project.
   - Accept a Decimal-compatible amount.
   - Use the single v1 currency.
   - Default status to `PENDING`.
   - Set `dueDate` on creation.
   - Keep `paidDate` null for a pending payment.

4. Validate monetary input before persistence.
   - Preserve Decimal precision.
   - Do not convert the authoritative amount to a JavaScript floating-point number.
   - Do not silently round or truncate.

5. For a `PENDING → PAID` transition:
   - Detect the status change.
   - Set `paidDate` to today.
   - Persist the status and date together.

6. For a `PAID → PENDING` transition:
   - Detect the status change.
   - Clear `paidDate`.
   - Persist the status and cleared date together.

7. When editing an already-paid payment:
   - Preserve the user's explicitly edited `paidDate`.
   - Do not reset it merely because unrelated payment fields changed.

8. Calculate outstanding totals from payment state.
   - Sum `amount` where `status = PENDING`.
   - Do not use `dueDate` to decide whether a payment belongs in outstanding totals.
   - Do not accept a client-calculated total.

9. Calculate paid totals only from `PAID` records.

10. Keep the payment ledger separate from payment-provider functionality.
    - Do not turn a ledger operation into invoicing.
    - Do not add PDF invoices, invoice numbering, tax calculation, or multi-currency handling.

11. If external payment processing is part of an explicitly approved task:
    - Keep provider-specific code behind the payment-provider boundary.
    - Never treat a browser-only success result as authoritative.
    - Require provider confirmation or an authenticated webhook before treating external payment success as authoritative.

12. Test the complete state transition and total after the mutation.

## Key Patterns

```ts
const amount = new Prisma.Decimal(input.amount)

await db.payment.create({
  data: {
    userId: session.user.id,
    projectId,
    amount,
    status: "PENDING",
    dueDate,
    paidDate: null,
  },
})
const data =
  input.status === "PAID"
    ? {
        status: "PAID" as const,
        paidDate: input.paidDate ?? new Date(),
      }
    : {
        status: "PENDING" as const,
        paidDate: null,
      }

await db.payment.update({
  where: { id: paymentId },
  data,
})
const outstanding = await db.payment.aggregate({
  _sum: { amount: true },
  where: {
    status: "PENDING",
  },
})
const paid = await db.payment.aggregate({
  _sum: { amount: true },
  where: {
    status: "PAID",
  },
})
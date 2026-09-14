---
trigger: glob
---

# Money and Billing Rules

## Purpose

Protect the financial integrity of the payment ledger without turning the v1 product into an invoicing or accounting platform.

## Scope

1. Treat v1 payment functionality as a payment ledger unless an explicit product decision expands the scope.

2. Do not implement invoicing, PDF invoice generation, tax calculation, accounting reconciliation, or multi-currency functionality as part of the payment ledger.

3. Use a single currency in v1.

## Monetary Data

4. Store monetary amounts using Decimal-compatible database types.

5. Never use JavaScript floating-point arithmetic as the authoritative representation of persisted monetary amounts.

6. Do not silently round, truncate, or convert payment amounts.

7. Preserve the configured monetary precision of `Decimal(12,2)`.

## Payment State

8. Payment status may only be:
   - `PENDING`
   - `PAID`

9. A newly created payment defaults to `PENDING`.

10. When a payment changes from `PENDING` to `PAID`, set `paidDate` to the current date.

11. `paidDate` may subsequently be edited according to the product's permitted payment-record behavior.

12. When a payment changes from `PAID` back to `PENDING`, clear `paidDate`.

13. Never leave a stale `paidDate` on a `PENDING` payment.

14. Keep `dueDate` and `paidDate` semantically separate:
   - `dueDate` means when payment is expected.
   - `paidDate` means when the payment was marked paid.

## Totals

15. The outstanding total must equal the sum of `amount` for payments whose status is `PENDING`.

16. Outstanding totals must not depend on whether `dueDate` has passed.

17. Do not exclude overdue or future-dated pending payments from the outstanding total.

18. Paid totals must be calculated only from payments whose status is `PAID`.

19. Financial totals must be calculated from persisted authoritative values, not from client-provided totals.

## Flutterwave

20. Flutterwave is the approved payment provider for actual payment-processing functionality.

21. Do not introduce Stripe, Paystack, PayPal, Razorpay, or another payment provider unless the product architecture explicitly changes.

22. Keep Flutterwave-specific implementation behind a payment-provider/service boundary.

23. Never expose Flutterwave secret credentials to client-side code.

24. Never mark a ledger payment as `PAID` solely because a client-side Flutterwave result reports success.

25. Verify provider-side payment confirmation or an authenticated webhook before treating an external payment as authoritative.

26. Do not make Flutterwave integration automatically expand the product into invoicing or accounting.

27. If the approved feature remains ledger-only, do not add checkout or payment collection merely because Flutterwave is available.
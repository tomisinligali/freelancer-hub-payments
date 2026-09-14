---
trigger: always_on
---

# Security Rules

## Purpose

Protect every freelancer's account and prevent unauthorized access to user-owned business, project, time, and payment data.

## Authentication

1. Require authentication for all protected application functionality.

2. Email/password authentication must enforce the minimum password requirements defined by the PRD.

3. Passwords must be stored using `password_hash` with bcrypt at the required cost.

4. Email verification is required before normal authenticated access.

5. Google OAuth may only auto-link an existing password account when Google's `email_verified` claim is true.

6. If the OAuth provider does not establish verified email ownership, require the defined password-reset verification flow before linking accounts.

7. Password-reset tokens must expire after one hour.

8. Use NextAuth for session management as defined by the architecture.

9. Preserve the defined 30-day inactivity session behavior.

## Authorization and Isolation

10. Authentication alone is never sufficient authorization for user-owned records.

11. Every read and write of Client, Project, TimeEntry, and Payment data must be scoped to the authenticated user's `userId`.

12. Never trust a client-supplied `userId`.

13. Never allow a request parameter to override the authenticated user's ownership scope.

14. Do not use an unscoped Prisma query for user-owned data.

15. Cross-user isolation tests are merge-blocking CI checks.

## Mutations

16. All application mutations must use Server Actions as defined by the architecture.

17. Validate all mutation input server-side before persistence.

18. Do not rely on client-side validation for security or data integrity.

19. Authorization must happen before performing a mutation.

20. Do not expose internal database errors, secrets, stack traces, or sensitive implementation details to users.

## Rate Limiting

21. Login attempts must be rate-limited to 5 attempts per 15 minutes per IP.

22. Password-reset attempts must be rate-limited to 5 attempts per 15 minutes per IP.

## Account Deletion

23. Account deletion must first deactivate the account rather than immediately destroying its data.

24. Preserve the 30-day grace period and allow reactivation during that period.

25. Hard deletion must occur only after the defined 30-day grace period through the scheduled deletion process.

26. Never allow a normal user request to bypass the defined deletion lifecycle.

## Secrets and External Services

27. Never expose API keys, OAuth secrets, Flutterwave credentials, AI provider keys, database credentials, or other secrets to the browser.

28. External API credentials must be used only in server-side code.

29. Treat all external API responses, webhooks, and AI outputs as untrusted input.

30. Never mark a payment as successful solely because a browser or client-side request claims that payment succeeded.

31. Validate webhook authenticity before accepting webhook-driven state changes.

32. Never log payment credentials, authentication tokens, API keys, passwords, or other secrets.

33. Security-sensitive behavior must have regression tests where practical, and failures must block completion.
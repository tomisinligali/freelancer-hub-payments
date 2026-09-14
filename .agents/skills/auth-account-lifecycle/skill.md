---
name: auth-account-lifecycle
description: Use for signup, email verification, Google OAuth, OAuth account linking, password reset, sessions, account deactivation, account reactivation, account deletion, DELETE confirmation, grace-period deletion, or scheduled hard deletion.
---

# Auth Account Lifecycle

This skill teaches the ordered implementation of authentication and account-lifecycle work. Its laws live in `security.md`, with the account requirements defined by the PRD and architecture in `AGENTS.md`.

## Procedure

1. Identify the lifecycle operation before changing code.
   - Signup
   - Email verification
   - Google OAuth
   - Password reset
   - Session handling
   - Account deletion
   - Account reactivation

2. Start from the authenticated or unauthenticated state required by the operation.
   - Public access is limited to signup, login, and landing.
   - Protected application operations require an authenticated session.

3. For email/password signup:
   - Validate the email and password at the server boundary.
   - Enforce the minimum 8-character password requirement.
   - Hash the password with bcrypt using cost factor 12.
   - Create the account with email verification still required.
   - Do not store the plaintext password.

4. For email verification:
   - Establish verified email ownership before granting normal authenticated access.
   - Preserve the user's account identity while changing only the verification state.

5. For Google OAuth:
   - Read the provider's `email_verified` claim.
   - If it is true, an existing password account may be linked by matching email.
   - If it is false or absent, do not auto-link.
   - Use the password-reset verification flow before linking such an account.

6. For password reset:
   - Generate the reset token through the existing reset flow.
   - Give the token a one-hour lifetime.
   - Rate-limit reset attempts to 5 per 15 minutes per IP.
   - Replace the stored password only after the reset flow has established authorization.

7. For sessions:
   - Use NextAuth.
   - Preserve JWT-based sessions.
   - Preserve the 30-day inactivity expiry.

8. For account deletion:
   - Require the exact typed confirmation `DELETE`.
   - Deactivate the account immediately.
   - Record the deletion start through `deactivatedAt`.
   - Block login while the account is deactivated.
   - Retain all account data during the 30-day grace period.

9. For reactivation:
   - Check that the account is still inside the 30-day grace period.
   - Require the defined reactivation confirmation.
   - Remove the deactivation state.
   - Restore normal login access.
   - Do not recreate deleted records.

10. For final deletion:
    - Run the scheduled deletion process only after the 30-day grace period.
    - Hard-delete the user and owned data through the defined cascade behavior.
    - Do not allow an ordinary user request to bypass the lifecycle.

11. Keep security decisions server-side.
    - Never trust client claims about verification, identity, deletion state, or authorization.
    - Never expose password hashes, reset tokens, OAuth secrets, or session secrets.

## Key Patterns

```ts
// Server-side password creation
const passwordHash = await bcrypt.hash(password, 12)

await prisma.user.create({
  data: {
    email,
    passwordHash,
    emailVerified: null,
  },
})
// OAuth linking decision
if (googleProfile.emailVerified === true) {
  // Existing account may be linked.
} else {
  // Do not auto-link.
  // Require the password-reset verification flow.
}
// Account deletion state transition
await prisma.user.update({
  where: { id: session.user.id },
  data: {
    deactivatedAt: new Date(),
  },
})
// Final deletion
await prisma.user.delete({
  where: {
    id: user.id,
  },
})
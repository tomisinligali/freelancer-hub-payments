import { sendVerificationEmail, sendPasswordResetEmail } from "@/lib/mail";

/**
 * Lightweight in-process background job.
 *
 * Dispatches the email send without blocking the request that created the
 * account or reset token, so the action returns immediately while the message
 * goes out in the background. Failures are logged and never crash the request.
 */
export function enqueueVerificationEmail(email: string, code: string): void {
  void Promise.resolve().then(async () => {
    try {
      await sendVerificationEmail(email, code);
    } catch (err: unknown) {
      console.error("[email-job] verification email failed:", err);
    }
  });
}

export function enqueuePasswordResetEmail(email: string, token: string): void {
  void Promise.resolve().then(async () => {
    try {
      await sendPasswordResetEmail(email, token);
    } catch (err: unknown) {
      console.error("[email-job] password reset email failed:", err);
    }
  });
}
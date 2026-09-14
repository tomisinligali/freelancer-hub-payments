import crypto from "node:crypto";

/**
 * Generates a valid Auth.js CSRF token for this server.
 *
 * Auth.js signs the token as a double-submit cookie value of the form
 * `token|hash` where `hash = sha256(token + secret)` (see
 * @auth/core createCSRFToken). Rotating with our own secret keeps the token
 * valid for every subsequent `/api/auth/*` request while guaranteeing a new
 * value after login and before the next sign-in attempt.
 */
export function createCsrfToken(): string {
  const secret = process.env.NEXTAUTH_SECRET || "";
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(`${token}${secret}`, "utf8").digest("hex");
  return `${token}|${hash}`;
}

export const CSRF_COOKIE_NAME = "authjs.csrf-token";

export const CSRF_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};
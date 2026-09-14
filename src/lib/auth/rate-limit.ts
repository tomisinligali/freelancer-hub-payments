import { CredentialsSignin } from "@auth/core/errors";
import { prisma } from "@/lib/db/prisma";

/**
 * Thrown when the (email, ip) pair is currently locked out.
 * The `code` is surfaced to the client as `code=Locked-<minutes>`.
 */
export class AttemptLockedError extends CredentialsSignin {
  constructor(remainingMinutes: number) {
    super("Too many failed login attempts. Account is temporarily locked.");
    this.code = `Locked-${remainingMinutes}`;
  }
}

function minutes(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60000));
}

/**
 * Progressive lockout schedule keyed by consecutive failed attempts.
 * - 1-2 failures: no lockout
 * - 3+ failures: 2 minutes
 * - escalates by doubling up to 24 hours
 */
export function lockoutDurationMinutes(failures: number): number {
  if (failures < 3) return 0;
  if (failures >= 23) return 24 * 60;
  return Math.min(2 * 2 ** (failures - 3), 24 * 60);
}

export function getClientIp(request: Request | Headers): string {
  const headers = request instanceof Request ? request.headers : request;
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim() || "unknown";
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export function lockedMessage(remainingMinutes: number): string {
  return `Too many failed attempts. Please try again in ${remainingMinutes} minute${
    remainingMinutes === 1 ? "" : "s"
  }.`;
}

export async function isLoginLocked(email: string, ip: string): Promise<number> {
  const row = await prisma.loginAttempt.findUnique({
    where: { email_ip: { email, ip } },
  });

  if (row?.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
    return minutes(row.lockedUntil.getTime() - Date.now());
  }

  return 0;
}

export async function enforceLoginRateLimit(email: string, ip: string): Promise<void> {
  const remaining = await isLoginLocked(email, ip);
  if (remaining > 0) {
    throw new AttemptLockedError(remaining);
  }
}

export async function recordLoginFailure(email: string, ip: string): Promise<void> {
  const now = new Date();

  const existing = await prisma.loginAttempt.findUnique({
    where: { email_ip: { email, ip } },
  });

  if (existing) {
    const failures = existing.failures + 1;
    const durationMinutes = lockoutDurationMinutes(failures);
    const lockedUntil =
      durationMinutes > 0 ? new Date(now.getTime() + durationMinutes * 60000) : null;

    await prisma.loginAttempt.update({
      where: { id: existing.id },
      data: {
        failures,
        lockedUntil,
        lastAttempt: now,
      },
    });
    return;
  }

  await prisma.loginAttempt.create({
    data: {
      email,
      ip,
      failures: 1,
      lockedUntil: null,
      lastAttempt: now,
    },
  });
}

export async function clearLoginFailures(email: string, ip: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({
    where: { email, ip },
  });
}
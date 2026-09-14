import crypto from "crypto";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  signupSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  emailSchema,
  idempotencyKeySchema,
  verifyCodeSchema,
  splitFullName,
  type ResetPasswordInput,
} from "@/lib/validation/auth";
import { enqueueVerificationEmail, enqueuePasswordResetEmail } from "@/lib/background/email-jobs";
import {
  getClientIp,
  isLoginLocked,
  recordLoginFailure,
  clearLoginFailures,
  lockedMessage,
} from "@/lib/auth/rate-limit";
import {
  createCsrfToken,
  CSRF_COOKIE_NAME,
  CSRF_COOKIE_OPTIONS,
} from "@/lib/auth/csrf";

const SUCCESS_MESSAGE =
  "Account created successfully. Enter the verification code sent to your email.";

const RESEND_COOLDOWN_MS = 60_000;
const CODE_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

interface FlowBody {
  success: boolean;
  error?: string;
  message?: string;
}

function json(
  status: number,
  body: FlowBody,
  headers?: Record<string, string>
): NextResponse {
  return NextResponse.json(body, { status, headers });
}

function lockedResponse(minutes: number): NextResponse {
  return json(429, { success: false, error: lockedMessage(minutes) }, {
    "Retry-After": String(minutes * 60),
  });
}

/**
 * Mutating auth endpoints accept JSON only. A cross-site form cannot send a
 * JSON Content-Type without CORS preflight permission (which we never grant),
 * so this requirement is itself a CSRF control for the API layer.
 */
function requireJson(req: Request): null | NextResponse {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return json(415, {
      success: false,
      error: "Content-Type must be application/json.",
    });
  }
  return null;
}

async function readJson(
  req: Request
): Promise<{ parsed: Record<string, unknown>; error: NextResponse | null }> {
  const contentTypeError = requireJson(req);
  if (contentTypeError) return { parsed: {}, error: contentTypeError };
  try {
    const parsed = await req.json();
    return {
      parsed: parsed && typeof parsed === "object" ? parsed : {},
      error: null,
    };
  } catch {
    return { parsed: {}, error: json(400, { success: false, error: "Invalid JSON body." }) };
  }
}

function firstIssueMessage<T>(result: { success: boolean; error?: { issues: { message: string }[] } }): string {
  return result.success ? "" : (result.error?.issues[0]?.message ?? "Invalid input.");
}

export async function handleSignup(req: Request): Promise<NextResponse> {
  const { parsed, error: readError } = await readJson(req);
  if (readError) return readError;
  const ip = getClientIp(req);

  const validation = signupSchema.safeParse(parsed);
  if (!validation.success) {
    return json(400, { success: false, error: firstIssueMessage(validation) });
  }

  const keyParsed = idempotencyKeySchema.safeParse(parsed.idempotencyKey);
  if (!keyParsed.success) {
    return json(400, {
      success: false,
      error: keyParsed.error.issues[0]?.message || "Invalid idempotency key.",
    });
  }

  const { fullName, email, password } = validation.data;
  const idempotencyKey = keyParsed.data;

  const lockedMinutes = await isLoginLocked(email, ip);
  if (lockedMinutes > 0) return lockedResponse(lockedMinutes);

  try {
    const existingRequest = await prisma.accountRequest.findUnique({
      where: { idempotencyKey },
    });

    if (existingRequest) {
      if (existingRequest.status === "COMPLETED") {
        const user = await prisma.user.findUnique({
          where: { email: existingRequest.email },
        });
        return user
          ? json(200, { success: true, message: SUCCESS_MESSAGE })
          : json(409, {
              success: false,
              error: "This signup request was already processed.",
            });
      }
      return json(409, {
        success: false,
        error: "This signup request is already being processed. Please wait.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const nameParts = splitFullName(fullName);
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);

    let user: { id: string; email: string } | null = null;
    let confirmationCode = "";

    for (let attempt = 0; attempt < 3; attempt++) {
      const verificationCode = generateVerificationCode();
      confirmationCode = verificationCode;

      try {
        user = await prisma.$transaction(async tx => {
          const created = await tx.user.create({
            data: {
              email,
              fullName: nameParts.fullName,
              firstName: nameParts.firstName,
              middleName: nameParts.middleName,
              lastName: nameParts.lastName,
              passwordHash,
              emailVerified: null,
            },
          });

          await tx.verificationToken.create({
            data: {
              identifier: email,
              token: verificationCode,
              type: "email_verification",
              expiresAt,
            },
          });

          await tx.accountRequest.create({
            data: {
              idempotencyKey,
              email,
              status: "COMPLETED",
              completedAt: new Date(),
            },
          });

          return { id: created.id, email: created.email };
        });
        break;
      } catch (err: unknown) {
        const violation = classifyUniqueViolation(err);
        if (!violation.isUnique) throw err;

        if (mentionsConstraint(violation.targets, "idempotencyKey")) {
          const winner = await prisma.accountRequest.findUnique({
            where: { idempotencyKey },
          });
          if (winner?.status === "COMPLETED") {
            return json(200, { success: true, message: SUCCESS_MESSAGE });
          }
          return json(409, {
            success: false,
            error: "An account with this email already exists.",
          });
        }

        if (mentionsConstraint(violation.targets, "email")) {
          await recordLoginFailure(email, ip);
          return json(409, {
            success: false,
            error: "An account with this email already exists.",
          });
        }

        if (mentionsConstraint(violation.targets, "token")) {
          continue;
        }

        throw err;
      }
    }

    if (!user) {
      await recordLoginFailure(email, ip);
      return json(500, {
        success: false,
        error: "An unexpected error occurred while creating your account. Please try again.",
      });
    }

    enqueueVerificationEmail(email, confirmationCode);
    await clearLoginFailures(email, ip);

    return json(200, { success: true, message: SUCCESS_MESSAGE });
  } catch (err: unknown) {
    console.error("Signup error:", err);
    await recordLoginFailure(email, ip);
    return json(500, {
      success: false,
      error: "An unexpected error occurred while creating your account. Please try again.",
    });
  }
}

export async function handleVerifyEmail(req: Request): Promise<NextResponse> {
  const { parsed, error: readError } = await readJson(req);
  if (readError) return readError;

  const codeResult = verifyCodeSchema.safeParse(parsed?.code);
  if (!codeResult.success) {
    return json(400, {
      success: false,
      error: codeResult.error.issues[0]?.message || "Invalid verification code.",
    });
  }
  const code = codeResult.data;

  try {
    const record = await prisma.verificationToken.findUnique({
      where: { token: code },
    });

    if (!record || record.type !== "email_verification") {
      return json(400, { success: false, error: "Invalid or expired verification code." });
    }

    if (new Date() > record.expiresAt) {
      await prisma.verificationToken.delete({
        where: { id: record.id },
      });
      return json(410, {
        success: false,
        error: "Verification code has expired. Please request a new one.",
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: record.identifier },
    });

    if (!user) {
      return json(400, { success: false, error: "User account not found." });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: new Date() },
    });

    await prisma.verificationToken.delete({
      where: { id: record.id },
    });

    return json(200, {
      success: true,
      message: "Email verified successfully! You can now sign in to your account.",
    });
  } catch (err: unknown) {
    console.error("Email verification error:", err);
    return json(500, {
      success: false,
      error: "An unexpected error occurred during verification. Please try again.",
    });
  }
}

export async function handleResendVerification(req: Request): Promise<NextResponse> {
  const { parsed, error: readError } = await readJson(req);
  if (readError) return readError;
  const ip = getClientIp(req);

  const parsedEmail = emailSchema.safeParse(parsed.email);
  if (!parsedEmail.success) {
    await recordLoginFailure("", ip);
    return json(400, { success: false, error: "Please enter a valid email address." });
  }

  const email = parsedEmail.data;

  const lockedMinutes = await isLoginLocked(email, ip);
  if (lockedMinutes > 0) return lockedResponse(lockedMinutes);

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      await recordLoginFailure(email, ip);
      return json(404, { success: false, error: "No account found for this email." });
    }

    if (user.emailVerified) {
      return json(409, {
        success: false,
        error: "Your email is already verified. You can sign in to your account.",
      });
    }

    const now = Date.now();

    const existing = await prisma.verificationToken.findFirst({
      where: { identifier: email, type: "email_verification" },
      orderBy: { createdAt: "desc" },
    });

    if (existing && now - existing.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      return json(429, {
        success: false,
        error: `Please wait ${Math.ceil(
          (RESEND_COOLDOWN_MS - (now - existing.createdAt.getTime())) / 1000
        )} seconds before requesting a new code.`,
      });
    }

    const verificationCode = generateVerificationCode();

    await prisma.verificationToken.deleteMany({
      where: { identifier: email, type: "email_verification" },
    });

    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token: verificationCode,
        type: "email_verification",
        expiresAt: new Date(now + CODE_TTL_MS),
      },
    });

    enqueueVerificationEmail(email, verificationCode);
    await clearLoginFailures(email, ip);

    return json(200, {
      success: true,
      message: "A new verification code has been sent to your email.",
    });
  } catch (err: unknown) {
    console.error("Resend verification error:", err);
    await recordLoginFailure(email, ip);
    return json(500, {
      success: false,
      error: "An unexpected error occurred. Please try again.",
    });
  }
}

export async function handleForgotPassword(req: Request): Promise<NextResponse> {
  const { parsed, error: readError } = await readJson(req);
  if (readError) return readError;
  const ip = getClientIp(req);

  const validation = forgotPasswordSchema.safeParse(parsed);
  if (!validation.success) {
    await recordLoginFailure("", ip);
    return json(400, {
      success: false,
      error: validation.error.issues[0]?.message || "Valid email is required.",
    });
  }

  const { email } = validation.data;

  const lockedMinutes = await isLoginLocked(email, ip);
  if (lockedMinutes > 0) return lockedResponse(lockedMinutes);

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Don't leak user existence; a generic positive response is still
      // a "no email sent" outcome, so it has a cost (anti-enumeration).
      await recordLoginFailure(email, ip);
      return json(200, {
        success: true,
        message:
          "If that email address is in our system, you will receive a password reset link shortly.",
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await prisma.verificationToken.deleteMany({
      where: { identifier: email, type: "password_reset" },
    });

    await prisma.verificationToken.create({
      data: { identifier: email, token, type: "password_reset", expiresAt },
    });

    await clearLoginFailures(email, ip);
    enqueuePasswordResetEmail(email, token);

    return json(200, {
      success: true,
      message:
        "If that email address is in our system, you will receive a password reset link shortly.",
    });
  } catch (err: unknown) {
    console.error("Forgot password error:", err);
    await recordLoginFailure(email, ip);
    return json(500, {
      success: false,
      error: "An unexpected error occurred. Please try again later.",
    });
  }
}

export async function handleResetPassword(req: Request): Promise<NextResponse> {
  const { parsed, error: readError } = await readJson(req);
  if (readError) return readError;

  parsed.token = typeof parsed.token === "string" ? parsed.token : "";
  const resetInput: ResetPasswordInput = parsed as ResetPasswordInput;

  const validation = resetPasswordSchema.safeParse(resetInput);
  if (!validation.success) {
    return json(400, {
      success: false,
      error: validation.error.issues[0]?.message || "Invalid input.",
    });
  }

  const { token, password } = validation.data;

  try {
    const record = await prisma.verificationToken.findUnique({
      where: { token },
    });

    if (!record || record.type !== "password_reset") {
      return json(400, { success: false, error: "Invalid or expired password reset link." });
    }

    if (new Date() > record.expiresAt) {
      await prisma.verificationToken.delete({
        where: { id: record.id },
      });
      return json(410, {
        success: false,
        error: "Password reset link has expired. Please request a new one.",
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: record.identifier },
    });

    if (!user) {
      return json(400, { success: false, error: "User account not found." });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await prisma.verificationToken.delete({
      where: { id: record.id },
    });

    return json(200, {
      success: true,
      message: "Password reset successfully. You can now sign in with your new password.",
    });
  } catch (err: unknown) {
    console.error("Reset password error:", err);
    return json(500, {
      success: false,
      error: "An unexpected error occurred while resetting your password. Please try again.",
    });
  }
}

export async function handleCsrfRotate(req: Request): Promise<NextResponse> {
  const readError = requireJson(req);
  if (readError) return readError;

  const store = await cookies();
  store.set(CSRF_COOKIE_NAME, encodeURIComponent(createCsrfToken()), CSRF_COOKIE_OPTIONS);
  return json(200, { success: true });
}

function generateVerificationCode(): string {
  const raw = crypto.randomBytes(32);
  return (raw.readUInt32BE(0) % 1000000).toString().padStart(6, "0");
}

function extractConstraintNames(err: unknown): string[] {
  const names = new Set<string>();
  const seen = new Set<object>();
  const scan = (value: unknown): void => {
    if (!value || typeof value !== "object" || seen.has(value as object)) return;
    seen.add(value as object);
    const obj = value as Record<string, unknown>;
    const constraint = obj.constraint;
    if (constraint && typeof constraint === "object") {
      const index = (constraint as { index?: unknown }).index;
      if (typeof index === "string") names.add(index);
    }
    if (typeof constraint === "string") names.add(constraint);
    if (Array.isArray(obj.target)) obj.target.forEach(t => names.add(String(t)));
    if (typeof obj.target === "string") names.add(obj.target);
    if (typeof obj.originalMessage === "string") {
      const match = obj.originalMessage.match(/constraint "([^"]+)"/);
      if (match) names.add(match[1]);
    }
    for (const key of Object.keys(obj)) {
      scan(obj[key]);
    }
  };
  scan(err);
  scan((err as { meta?: unknown }).meta);
  return [...names];
}

function classifyUniqueViolation(
  err: unknown
): { isUnique: true; targets: string[] } | { isUnique: false } {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return { isUnique: true, targets: extractConstraintNames(err) };
  }
  return { isUnique: false };
}

function mentionsConstraint(targets: string[], name: string): boolean {
  return targets.some(t => t.toLowerCase().includes(name.toLowerCase()));
}
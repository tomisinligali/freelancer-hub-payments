import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required.")
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Please enter a valid email address.");

const passwordSchema = z
  .string()
  .trim()
  .min(1, "Password is required.")
  .min(8, "Password must be at least 8 characters long.")
  .max(64, "Password must be at most 64 characters long.")
  .superRefine((value, ctx) => {
    if (!/[a-z]/.test(value)) {
      ctx.addIssue({
        code: "custom",
        message: "Password must contain a lowercase letter",
        path: ["password"],
      });
    }
    if (!/[A-Z]/.test(value)) {
      ctx.addIssue({
        code: "custom",
        message: "Password must contain an uppercase letter",
        path: ["password"],
      });
    }
    if (!/\d/.test(value)) {
      ctx.addIssue({
        code: "custom",
        message: "Password must contain a number",
        path: ["password"],
      });
    }
    if (!/[#@>^]/.test(value)) {
      ctx.addIssue({
        code: "custom",
        message: "Password must contain a special character (#@>^)",
        path: ["password"],
      });
    }
  });

const fullNameSchema = z
  .string()
  .trim()
  .min(1, "Full name field cannot be empty")
  .transform(v => v.replace(/\s+/g, " "))
  .refine(v => /^[A-Za-z\s]+$/.test(v), "Full name must use only letters.")
  .refine(v => {
    const words = v.split(" ").filter(Boolean);
    return words.length >= 2;
  }, "Full name must include at least two names.");

export const signupSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, "Reset token is missing or invalid."),
  password: passwordSchema,
  confirmPassword: passwordSchema,
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords do not match.",
  path: ["confirmPassword"],
});

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1, "Idempotency key is missing.")
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Idempotency key is malformed."
  );

export const verifyCodeSchema = z
  .string()
  .trim()
  .min(1, "Verification code is required.")
  .regex(/^\d{6}$/, "Verification code must be a 6-digit number.");

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyCodeInput = z.infer<typeof verifyCodeSchema>;

export interface FullNameParts {
  fullName: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
}

export function splitFullName(fullName: string): FullNameParts {
  const clean = fullName.trim().replace(/\s+/g, " ");
  const words = clean.split(" ").filter(Boolean);
  const firstName = words[0];
  const lastName = words[words.length - 1];
  const middleWords = words.slice(1, -1);
  return {
    fullName: clean,
    firstName,
    middleName: middleWords.length > 0 ? middleWords.join(" ") : null,
    lastName,
  };
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  fieldErrors?: Record<string, string>;
}

export function validateSignupInput(formData: FormData): ValidationResult<SignupInput> {
  const parsed = signupSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid input.",
      fieldErrors: flattenZodIssues(parsed.error.issues),
    };
  }
  return { success: true, data: parsed.data };
}

export function validateLoginInput(formData: FormData): ValidationResult<LoginInput> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid input.",
      fieldErrors: flattenZodIssues(parsed.error.issues),
    };
  }
  return { success: true, data: parsed.data };
}

export function validateForgotPasswordInput(
  formData: FormData
): ValidationResult<ForgotPasswordInput> {
  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid input.",
      fieldErrors: flattenZodIssues(parsed.error.issues),
    };
  }
  return { success: true, data: parsed.data };
}

export function validateResetPasswordInput(
  formData: FormData
): ValidationResult<ResetPasswordInput> {
  const picked = {
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  };
  const parsed = resetPasswordSchema.safeParse(picked);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || "Invalid input.",
      fieldErrors: flattenZodIssues(parsed.error.issues),
    };
  }
  return { success: true, data: parsed.data };
}

function flattenZodIssues(issues: z.ZodIssue[]): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.join(".");
    if (key && !mapped[key]) {
      mapped[key] = issue.message;
    }
  }
  return mapped;
}

function firstFieldError(schema: z.ZodTypeAny, values: Record<string, unknown>): {
  message: string;
  fieldErrors: Record<string, string>;
} {
  const parsed = schema.safeParse(values);
  if (parsed.success) {
    return { message: "", fieldErrors: {} };
  }
  const issues = (parsed as { error: { issues: z.ZodIssue[] } }).error.issues;
  return {
    message: issues[0]?.message || "",
    fieldErrors: flattenZodIssues(issues),
  };
}

function scalarError(schema: z.ZodTypeAny, value: unknown): string {
  const parsed = schema.safeParse(value);
  if (parsed.success) return "";
  const issues = (parsed as { error: { issues: z.ZodIssue[] } }).error.issues;
  return issues[0]?.message || "";
}

export function validateField(
  schema: z.ZodTypeAny,
  values: Record<string, unknown>
): { message: string; fieldErrors: Record<string, string> } {
  return firstFieldError(schema, values);
}

export const clientValidation = {
  email: (value: string) =>
    scalarError(emailSchema, value),
  password: (value: string) =>
    scalarError(passwordSchema, value),
  fullName: (value: string) =>
    firstFieldError(signupSchema.pick({ fullName: true }), { fullName: value })
      .message,
  signup: (values: { fullName: string; email: string; password: string }) =>
    firstFieldError(signupSchema, values),
  login: (values: { email: string; password: string }) =>
    firstFieldError(loginSchema, values),
  forgotPassword: (values: { email: string }) =>
    firstFieldError(forgotPasswordSchema, values),
  resetPassword: (values: {
    token: string;
    password: string;
    confirmPassword: string;
  }) => firstFieldError(resetPasswordSchema, values),
  verifyCode: (value: string) =>
    scalarError(verifyCodeSchema, value),
};

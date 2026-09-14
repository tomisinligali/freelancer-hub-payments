"use client";

import React, {
  useCallback,
  useEffect,
  useState,
  useTransition,
  Suspense,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { clientValidation } from "@/lib/validation/auth";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { FormMessage } from "@/components/ui/FormMessage";

type AuthView = "signin" | "signup" | "forgot" | "reset" | "verify";

const IDEMPOTENCY_STORAGE_KEY = "fh:signup:idempotencyKey";

function getOrCreateIdempotencyKey(): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  const existing = window.sessionStorage.getItem(IDEMPOTENCY_STORAGE_KEY);
  if (existing) return existing;
  const key = crypto.randomUUID();
  window.sessionStorage.setItem(IDEMPOTENCY_STORAGE_KEY, key);
  return key;
}

function clearIdempotencyKey() {
  try {
    window.sessionStorage.removeItem(IDEMPOTENCY_STORAGE_KEY);
  } catch {
    // storage unavailable — key will simply rotate on next render
  }
}

interface ApiResponse {
  success: boolean;
  error?: string;
  message?: string;
}

async function postJson(
  path: string,
  body?: Record<string, unknown>
): Promise<ApiResponse> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    return (await res.json()) as ApiResponse;
  } catch {
    return { success: false, error: "Unexpected server response. Please try again." };
  }
}

const VIEW_CONFIG: Record<
  AuthView,
  { title: string; documentTitle: string; subtitle: string }
> = {
  signin: {
    title: "Welcome back",
    documentTitle: "Sign in",
    subtitle: "Sign in to your Freelancer Hub account",
  },
  signup: {
    title: "Create your account",
    documentTitle: "Create account",
    subtitle: "Create your account to safely access your freelance workspace",
  },
  forgot: {
    title: "Reset password",
    documentTitle: "Forgot password",
    subtitle: "Enter your email address and we'll send you a link to reset your password.",
  },
  reset: {
    title: "Set new password",
    documentTitle: "Reset password",
    subtitle: "Choose a new password for your account",
  },
  verify: {
    title: "Email Verification",
    documentTitle: "Verify email",
    subtitle: "Confirm your email to complete registration",
  },
};

const VALID_VIEWS: AuthView[] = ["signin", "signup", "forgot", "reset", "verify"];

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: "Invalid email or password.",
  Configuration: "Authentication is not configured correctly.",
  Default: "An error occurred while trying to sign in.",
  MissingCSRF: "Session expired. Please try again.",
  Verification: "The verification link is invalid or has expired.",
  AccessDenied: "You don't have access to sign in with this account.",
};

const CODE_MESSAGES: Record<string, string> = {
  invalid_credentials: "Invalid email or password.",
  unverified_email: "Please verify your email address before signing in.",
  account_deactivated: "This account is currently deactivated.",
};

function parseError(raw: string | null): string | null {
  if (!raw) return null;
  return ERROR_MESSAGES[raw] || ERROR_MESSAGES.Default;
}

function parseSignInError(error?: string, code?: string): string {
  if (code?.startsWith("Locked-")) {
    const mins = Number(code.split("-")[1]);
    if (Number.isFinite(mins) && mins > 0) {
      return `Too many failed login attempts. Please try again in ${mins} minute${mins === 1 ? "" : "s"}.`;
    }
    return "Too many failed login attempts. Please try again later.";
  }
  if (code && CODE_MESSAGES[code]) {
    return CODE_MESSAGES[code];
  }
  return ERROR_MESSAGES[error ?? ""] || ERROR_MESSAGES.Default;
}

function parseView(raw: string | null): AuthView {
  return VALID_VIEWS.includes(raw as AuthView) ? (raw as AuthView) : "signup";
}

function makeFieldBlur(
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>
) {
  return (name: string, label: string) => (
    e: React.FocusEvent<HTMLInputElement>
  ) => {
    const value = e.target.value.trim();
    setFieldErrors(prev => ({
      ...prev,
      [name]: value ? "" : `${label} field cannot be empty`,
    }));
  };
}

const PASSWORD_RULES: { label: string; test: (password: string) => boolean; last?: boolean }[] = [
  { label: "Password must contain a lowercase letter", test: p => /[a-z]/.test(p) },
  { label: "Password must contain an uppercase letter", test: p => /[A-Z]/.test(p) },
  { label: "Password must contain a number", test: p => /\d/.test(p) },
  { label: "Password must contain a special character (#@>^)", test: p => /[#@>^]/.test(p) },
  { label: "Minimum of 8 characters", test: p => p.length >= 8 && p.length <= 64, last: true },
];

function PasswordRequirements({ password }: { password: string }) {
  if (password.length === 0) return null;

  const unmet = PASSWORD_RULES.filter(rule => !rule.test(password));
  const ordered = [...unmet.filter(rule => !rule.last), ...unmet.filter(rule => rule.last)];

  if (ordered.length === 0) return null;

  return (
    <ul className="fh-password-reqs">
      {ordered.map(rule => (
        <li key={rule.label} className="fh-password-req">
          <span className="fh-password-req-marker" aria-hidden="true">
            ○
          </span>
          {rule.label}
        </li>
      ))}
    </ul>
  );
}

function AuthFooter({
  text,
  actionLabel,
  onAction,
}: {
  text: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <footer className="fh-auth-footer">
      <p className="fh-auth-footer-text">
        {text}{" "}
        <button
          type="button"
          onClick={onAction}
          className="fh-auth-link"
        >
          {actionLabel}
        </button>
      </p>
    </footer>
  );
}

function SignInForm({
  onSwitchView,
  initialError,
}: {
  onSwitchView: (view: AuthView) => void;
  initialError: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(initialError);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [values, setValues] = useState<{ email: string; password: string }>({
    email: "",
    password: "",
  });

  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const handleFieldBlur = (name: "email" | "password") => () => {
    const value = values[name].trim();
    if (value) return;
    setFieldErrors(prev => ({
      ...prev,
      [name]: `${name === "email" ? "Email address" : "Password"} field cannot be empty`,
    }));
  };

  const handleFieldChange = (name: "email" | "password") => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = e.target.value;
    setValues(prev => ({ ...prev, [name]: value }));
    const result = clientValidation.login({ ...values, [name]: value });
    setFieldErrors(result.fieldErrors);
  };

  const canSubmit =
    clientValidation.login(values).fieldErrors.email === undefined &&
    clientValidation.login(values).fieldErrors.password === undefined;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const result = clientValidation.login(values);
    setFieldErrors(result.fieldErrors);
    if (Object.keys(result.fieldErrors).length > 0) return;

    const email = values.email.trim();
    const password = values.password;

    startTransition(async () => {
      try {
        // Pre-login: rotate to a fresh CSRF token so this attempt never reuses a stale one
        await postJson("/api/auth/csrf-rotate");

        const result = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });

        if (result?.error) {
          setError(parseSignInError(result.error, result.code));
        } else {
          // Post-login: the authenticated session must not keep the pre-login CSRF token
          await postJson("/api/auth/csrf-rotate");
          router.push(callbackUrl);
          router.refresh();
        }
      } catch (err: unknown) {
        console.error("Sign in error:", err);
        setError("Failed to sign in. Please check your credentials.");
      }
    });
  };

  return (
    <>
      <FormMessage type="error" message={error} />

      <form onSubmit={handleSubmit} className="fh-auth-form" noValidate>
        <Input
          label="Email address"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          autoFocus
          error={fieldErrors.email}
          onBlur={handleFieldBlur("email")}
          onChange={handleFieldChange("email")}
        />
        <div className="fh-password-field-wrapper">
          <Input
            label="Password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            error={fieldErrors.password}
onBlur={handleFieldBlur("password")}
          onChange={handleFieldChange("password")}
          />
          <div className="fh-forgot-password-link-wrapper">
            <button
              type="button"
              onClick={() => onSwitchView("forgot")}
              className="fh-auth-link fh-auth-link--small"
            >
              Forgot password?
            </button>
          </div>
        </div>

        <Button type="submit" disabled={!canSubmit} isLoading={isPending} className="fh-auth-submit">
          Sign in
        </Button>
      </form>

      <AuthFooter
        text="Don't have an account?"
        actionLabel="Create an account"
        onAction={() => onSwitchView("signup")}
      />
    </>
  );
}

function SignupForm({
  onSwitchView,
  onVerificationCreated,
}: {
  onSwitchView: (view: AuthView) => void;
  onVerificationCreated: (email: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [validated, setValidated] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<{
    fullName: string;
    email: string;
    password: string;
  }>({
    fullName: "",
    email: "",
    password: "",
  });

  const setFieldMessage = (
    name: string,
    message: string,
    isValid: boolean
  ) => {
    setFieldErrors(prev => ({ ...prev, [name]: message }));
    setValidated(prev => ({ ...prev, [name]: isValid }));
  };

  const handleFullNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setValues(prev => ({ ...prev, fullName: value }));
    setValidated(prev => ({ ...prev, fullName: false }));
    if (!value.trim()) return;
    const message = clientValidation.fullName(value);
    setFieldErrors(prev => ({ ...prev, fullName: message }));
  };

  const handleFullNameBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const fullName = e.target.value.trim();
    const message = clientValidation.fullName(fullName);
    setFieldMessage("fullName", message, !message && fullName.length > 0);
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const email = e.target.value;
    setValues(prev => ({ ...prev, email }));
    if (!email.trim()) {
      setFieldErrors(prev => ({ ...prev, email: "" }));
      setValidated(prev => ({ ...prev, email: false }));
      return;
    }
    const message = clientValidation.email(email);
    setFieldMessage("email", message, !message);
  };

  const handleEmailBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const email = e.target.value.trim();
    if (email) return;
    setFieldMessage("email", "Email address field cannot be empty", false);
  };

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setValues(prev => ({ ...prev, password: value }));
    setValidated(prev => ({ ...prev, password: false }));
    setFieldErrors(prev => ({ ...prev, password: "" }));
  };

  const handlePasswordBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const password = e.target.value.trim();
    const message = password
      ? clientValidation.password(password)
      : "Password field cannot be empty";
    setFieldMessage("password", message, !message);
  };

  const canSubmit =
    clientValidation.signup(values).fieldErrors.fullName === undefined &&
    clientValidation.signup(values).fieldErrors.email === undefined &&
    clientValidation.signup(values).fieldErrors.password === undefined &&
    values.fullName.trim() !== "" &&
    values.email.trim() !== "" &&
    values.password !== "";

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const result = clientValidation.signup(values);
    setFieldErrors(result.fieldErrors);
    if (Object.keys(result.fieldErrors).length > 0) return;

    if (result.message) {
      setError(result.message);
      return;
    }

    const signupPayload = {
      fullName: values.fullName.trim(),
      email: values.email.trim(),
      password: values.password,
      idempotencyKey: getOrCreateIdempotencyKey(),
    };

    startTransition(async () => {
      const res = await postJson("/api/auth/signup", signupPayload);
      if (!res.success) {
        setError(res.error || "Failed to create account.");
      } else {
        setSuccessMessage(res.message || "Account created! Please verify your email.");
        clearIdempotencyKey();
        setValues({ fullName: "", email: "", password: "" });
        setFieldErrors({});
        setValidated({});
        onVerificationCreated(values.email);
      }
    });
  };

  return (
    <>
      <FormMessage type="error" message={error} />
      <FormMessage type="success" message={successMessage} />

      {!successMessage ? (
        <form onSubmit={handleSubmit} className="fh-auth-form" noValidate>
          <Input
            label="Full name"
            name="fullName"
            type="text"
            required
            autoComplete="name"
            placeholder="Jane Doe"
            error={fieldErrors.fullName}
            valid={validated.fullName}
            onBlur={handleFullNameBlur}
            onChange={handleFullNameChange}
          />

          <Input
            label="Email address"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            error={fieldErrors.email}
            valid={validated.email}
            onBlur={handleEmailBlur}
            onChange={handleEmailChange}
          />

          <Input
            label="Password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            placeholder="••••••••"
            hint={<PasswordRequirements password={values.password} />}
            error={fieldErrors.password}
            valid={validated.password}
            onBlur={handlePasswordBlur}
            onChange={handlePasswordChange}
          />

          <Button type="submit" disabled={!canSubmit} isLoading={isPending} className="fh-auth-submit">
            Create account
          </Button>
        </form>
      ) : null}

      <AuthFooter
        text="Already have an account?"
        actionLabel="Sign in"
        onAction={() => onSwitchView("signin")}
      />
    </>
  );
}

function ForgotPasswordForm({ onSwitchView }: { onSwitchView: (view: AuthView) => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [email, setEmail] = useState("");

  const handleFieldBlur = makeFieldBlur(setFieldErrors);

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    const message = clientValidation.email(e.target.value);
    setFieldErrors(prev => ({ ...prev, email: message }));
  };

  const canSubmit = clientValidation.forgotPassword({ email }).fieldErrors.email
    ? false
    : email.trim() !== "";

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const result = clientValidation.forgotPassword({ email });
    setFieldErrors(result.fieldErrors);
    if (Object.keys(result.fieldErrors).length > 0) return;

    startTransition(async () => {
      const res = await postJson("/api/auth/forgot", { email: email.trim() });
      if (!res.success) {
        setError(res.error || "Failed to process request.");
      } else {
        setSuccessMessage(res.message || "Reset link generated.");
      }
    });
  };

  return (
    <>
      <FormMessage type="error" message={error} />
      <FormMessage type="success" message={successMessage} />

      {!successMessage ? (
        <form onSubmit={handleSubmit} className="fh-auth-form" noValidate>
          <Input
            label="Email address"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            error={fieldErrors.email}
            onBlur={handleFieldBlur("email", "Email address")}
            onChange={handleEmailChange}
          />

          <Button type="submit" disabled={!canSubmit} isLoading={isPending} className="fh-auth-submit">
            Send reset link
          </Button>
        </form>
      ) : null}

      <AuthFooter
        text="Remember your password?"
        actionLabel="Back to sign in"
        onAction={() => onSwitchView("signin")}
      />
    </>
  );
}

function ResetPasswordForm({
  token,
  onSwitchView,
}: {
  token: string;
  onSwitchView: (view: AuthView) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(
    !token ? "Missing or invalid password reset token." : null
  );
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleFieldBlur = makeFieldBlur(setFieldErrors);

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setPassword(value);
    const result = clientValidation.resetPassword({
      token,
      password: value,
      confirmPassword,
    });
    setFieldErrors(result.fieldErrors);
  };

  const handleConfirmPasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setConfirmPassword(value);
    const result = clientValidation.resetPassword({
      token,
      password,
      confirmPassword: value,
    });
    setFieldErrors(result.fieldErrors);
  };

  const canSubmit =
    clientValidation.resetPassword({ token, password, confirmPassword }).fieldErrors
      .password === undefined &&
    clientValidation.resetPassword({ token, password, confirmPassword }).fieldErrors
      .confirmPassword === undefined &&
    password.trim() !== "" &&
    confirmPassword.trim() !== "";

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const result = clientValidation.resetPassword({ token, password, confirmPassword });
    setFieldErrors(result.fieldErrors);
    if (Object.keys(result.fieldErrors).length > 0) return;

    startTransition(async () => {
      const res = await postJson("/api/auth/reset", {
        token,
        password: password.trim(),
        confirmPassword: confirmPassword.trim(),
      });
      if (!res.success) {
        setError(res.error || "Failed to reset password.");
      } else {
        setSuccessMessage(res.message || "Password reset successfully!");
      }
    });
  };

  return (
    <>
      <FormMessage type="error" message={error} />
      <FormMessage type="success" message={successMessage} />

      {!successMessage && token ? (
        <form onSubmit={handleSubmit} className="fh-auth-form" noValidate>
          <input type="hidden" name="token" value={token} />

          <Input
            label="New password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            placeholder="••••••••"
            helperText={!fieldErrors.password ? "8-64 characters with uppercase, lowercase, a number, and #@>^" : undefined}
            error={fieldErrors.password}
            onBlur={handleFieldBlur("password", "New password")}
            onChange={handlePasswordChange}
          />

          <Input
            label="Confirm new password"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            placeholder="••••••••"
            error={fieldErrors.confirmPassword}
            onBlur={handleFieldBlur("confirmPassword", "Confirm new password")}
            onChange={handleConfirmPasswordChange}
          />

          <Button type="submit" disabled={!canSubmit} isLoading={isPending} className="fh-auth-submit">
            Reset password
          </Button>
        </form>
      ) : null}

      <AuthFooter
        text=""
        actionLabel="Back to sign in"
        onAction={() => onSwitchView("signin")}
      />
    </>
  );
}

function VerifyEmailForm({
  email,
  onSwitchView,
}: {
  email: string;
  onSwitchView: (view: AuthView) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [codeValue, setCodeValue] = useState("");
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCodeValue(value);
    const err = clientValidation.verifyCode(value);
    setFieldErrors(prev => {
      const next = { ...prev };
      if (err) {
        next.code = err;
      } else {
        delete next.code;
      }
      return next;
    });
  };

  const canSubmit =
    clientValidation.verifyCode(codeValue) === "" && codeValue.trim() !== "";

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResend = () => {
    if (isResending || cooldown > 0 || !email) return;
    setIsResending(true);
    setResendMessage(null);
    setError(null);

    startTransition(async () => {
      const res = await postJson("/api/auth/resend", { email });
      setIsResending(false);
      if (!res.success) {
        setError(res.error || "Failed to resend the code.");
      } else {
        setResendMessage(res.message || "A new code has been sent.");
        setCooldown(60);
      }
    });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const codeError = clientValidation.verifyCode(codeValue);
    setFieldErrors(codeError ? { code: codeError } : {});
    if (codeError) return;

    startTransition(async () => {
      const res = await postJson("/api/auth/verify", { code: codeValue.trim() });
      if (!res.success) {
        setError(res.error || "Verification failed.");
      } else {
        setSuccessMessage(res.message || "Email verified successfully!");
      }
    });
  };

  return (
    <>
      <p className="fh-auth-subtitle">
        We emailed a one-time verification code to you. Enter the code below to
        activate your account.
      </p>

      <FormMessage type="error" message={error} />
      <FormMessage type="success" message={successMessage} />

      {!successMessage ? (
        <form onSubmit={handleSubmit} className="fh-auth-form" noValidate>
          <Input
            label="Verification code"
            name="code"
            type="text"
            required
            autoComplete="one-time-code"
            placeholder="Paste the code from your email"
            error={fieldErrors.code}
            onChange={handleCodeChange}
          />

          <Button type="submit" disabled={!canSubmit} isLoading={isPending} className="fh-auth-submit">
            Verify email
          </Button>

          <p className="fh-auth-footer-text fh-resend-row">
            Didn&apos;t receive the code?{" "}
            <button
              type="button"
              className="fh-auth-link"
              onClick={handleResend}
              disabled={isResending || cooldown > 0}
            >
              {isResending
                ? "Resending…"
                : cooldown > 0
                  ? `Resend code in ${cooldown}s`
                  : "Resend code"}
            </button>
          </p>
        </form>
      ) : null}

      {resendMessage ? (
        <FormMessage type="success" message={resendMessage} />
      ) : null}

      <AuthFooter
        text=""
        actionLabel="Proceed to sign in"
        onAction={() => onSwitchView("signin")}
      />
    </>
  );
}

function AuthPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [view, setView] = useState<AuthView>(() =>
    parseView(searchParams.get("view"))
  );
  const token = searchParams.get("token") || "";
  const [pendingVerifyEmail, setPendingVerifyEmail] = useState("");

  useEffect(() => {
    document.title = `${VIEW_CONFIG[view].documentTitle} | Freelancer Hub`;
  }, [view]);

  const isVerifyWithStaleToken = view === "verify" && Boolean(searchParams.get("token"));

  useEffect(() => {
    if (isVerifyWithStaleToken) {
      router.replace("/auth?view=verify");
    }
  }, [isVerifyWithStaleToken, router]);

  const navigate = useCallback((nextView: AuthView) => {
    setView(nextView);
  }, []);

  const handleVerificationCreated = useCallback((email: string) => {
    setPendingVerifyEmail(email);
    setView("verify");
  }, []);

  const config = VIEW_CONFIG[view];

  return (
    <div className="fh-auth-content">
      <div className="fh-auth-title-group">
        <h1 className="fh-auth-title">{config.title}</h1>
        {view !== "verify" ? (
          <p className="fh-auth-subtitle">{config.subtitle}</p>
        ) : null}
      </div>

      {view === "signin" ? (
        <SignInForm
          onSwitchView={navigate}
          initialError={parseError(searchParams.get("error"))}
        />
      ) : null}

      {view === "signup" ? (
        <SignupForm onSwitchView={navigate} onVerificationCreated={handleVerificationCreated} />
      ) : null}

      {view === "forgot" ? <ForgotPasswordForm onSwitchView={navigate} /> : null}

      {view === "reset" ? (
        <ResetPasswordForm token={token} onSwitchView={navigate} />
      ) : null}

      {view === "verify" ? (
        <VerifyEmailForm email={pendingVerifyEmail} onSwitchView={navigate} />
      ) : null}
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense
      fallback={
        <div className="fh-auth-content">
          <p className="fh-auth-subtitle">Loading...</p>
        </div>
      }
    >
      <AuthPageContent />
    </Suspense>
  );
}
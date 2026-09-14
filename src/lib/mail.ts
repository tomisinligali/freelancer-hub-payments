import nodemailer, { type Transporter } from "nodemailer";

function getAppUrl(): string {
  return (
    process.env.APP_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  );
}

let cachedTransporter: Transporter | null = null;

async function getTransporter(): Promise<Transporter> {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  // Option 1: Custom SMTP (e.g. Gmail App Password configured in .env)
  if (process.env.SMTP_HOST && process.env.SMTP_PASS) {
    cachedTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    return cachedTransporter;
  }

  // Option 2: Automatic Ethereal SMTP account for real email delivery & web preview
  try {
    const testAccount = await nodemailer.createTestAccount();
    cachedTransporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log(`[mail] Generated real Ethereal SMTP test mailbox: ${testAccount.user}`);
    return cachedTransporter;
  } catch (err) {
    console.error("[mail] Failed to create test SMTP account, falling back to JSON transport:", err);
    cachedTransporter = nodemailer.createTransport({ jsonTransport: true });
    return cachedTransporter;
  }
}

export const isMailConfigured = true;

export async function sendVerificationEmail(
  to: string,
  code: string
): Promise<void> {
  const baseUrl = getAppUrl();
  const from = process.env.MAIL_FROM || `"Freelancer Hub" <noreply@${new URL(baseUrl).hostname}>`;
  const verifyUrl = `${baseUrl}/auth?view=verify`;

  try {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from,
      to,
      subject: "Verify your Freelancer Hub email",
      text: `Welcome to Freelancer Hub!\n\nUse the one-time verification code below to activate your account before signing in.\n\nVerification code:\n${code}\n\nEnter this code in the verification form at:\n${verifyUrl}\n\nThis code expires in 24 hours and can only be used once.\n\nIf you did not create this account, you can safely ignore this email.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #7e2cde;">Welcome to Freelancer Hub</h2>
          <p>Use the one-time verification code below to activate your account before signing in.</p>
          <p style="font-size: 16px; color: #222; background: #faf6fe; border: 1px solid #eee; border-radius: 8px; padding: 12px 16px; word-break: break-all;">
            <strong>${code}</strong>
          </p>
          <p>
            Enter this code in the verification form at
            <a href="${verifyUrl}">${verifyUrl}</a>
          </p>
          <p style="font-size: 13px; color: #555;">This code expires in 24 hours and can only be used once.</p>
          <p style="font-size: 12px; color: #888;">If you did not create this account, you can safely ignore this email.</p>
        </div>
      `,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[mail] View sent email online inbox preview at: ${previewUrl}`);
    } else {
      console.info("[mail] Verification email sent successfully:", info.messageId);
    }
  } catch (error) {
    console.error("[mail error] Failed to dispatch SMTP email:", error);
  }
}

export async function sendPasswordResetEmail(
  to: string,
  token: string
): Promise<void> {
  const baseUrl = getAppUrl();
  const from = process.env.MAIL_FROM || `"Freelancer Hub" <noreply@${new URL(baseUrl).hostname}>`;
  const resetUrl = `${baseUrl}/auth?view=reset&token=${token}`;

  try {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from,
      to,
      subject: "Reset your Freelancer Hub password",
      text: `You requested a password reset for your Freelancer Hub account.\n\nClick the link below to choose a new password. This link expires in 1 hour and can only be used once:\n\n${resetUrl}\n\nIf you did not request a password reset, you can safely ignore this email.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #7e2cde;">Reset your Freelancer Hub password</h2>
          <p>You requested a password reset for your Freelancer Hub account.</p>
          <p>
            <a href="${resetUrl}" style="display: inline-block; background: #7e2cde; color: #fff; text-decoration: none; padding: 12px 20px; border-radius: 8px;">
              Reset your password
            </a>
          </p>
          <p>
            Or copy and paste this link into your browser:<br/>
            <span style="font-size: 13px; color: #555; word-break: break-all;">${resetUrl}</span>
          </p>
          <p style="font-size: 13px; color: #555;">This link expires in 1 hour and can only be used once.</p>
          <p style="font-size: 12px; color: #888;">If you did not request a password reset, you can safely ignore this email.</p>
        </div>
      `,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`[mail] View sent email online inbox preview at: ${previewUrl}`);
    } else {
      console.info("[mail] Password reset email sent successfully:", info.messageId);
    }
  } catch (error) {
    console.error("[mail error] Failed to dispatch SMTP email:", error);
  }
}
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { CredentialsSignin } from "@auth/core/errors";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { authConfig } from "@/lib/auth/auth.config";
import { loginSchema } from "@/lib/validation/auth";
import {
  enforceLoginRateLimit,
  getClientIp,
  recordLoginFailure,
  clearLoginFailures,
} from "@/lib/auth/rate-limit";

class InvalidCredentialsError extends CredentialsSignin {
  code = "invalid_credentials";
}

class UnverifiedEmailError extends CredentialsSignin {
  code = "unverified_email";
}

class DeactivatedAccountError extends CredentialsSignin {
  code = "account_deactivated";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  secret: process.env.NEXTAUTH_SECRET,
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days session per PRD & Security Rule 9
  },
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      },
    },
    csrfToken: {
      options: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      },
    },
  },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const ip = getClientIp(request);

        // Server-side schema validation mirrors the client (loginSchema)
        const parsed = loginSchema.safeParse({
          email: credentials?.email,
          password: credentials?.password,
        });
        if (!parsed.success) {
          const attemptedEmail =
            typeof credentials?.email === "string"
              ? String(credentials.email).trim().toLowerCase()
              : "";
          await recordLoginFailure(attemptedEmail, ip);
          throw new InvalidCredentialsError();
        }

        const { email, password } = parsed.data;

        // Security Rule: progressive lockout on repeated failed logins
        await enforceLoginRateLimit(email, ip);

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.passwordHash) {
          await recordLoginFailure(email, ip);
          throw new InvalidCredentialsError();
        }

        if (user.deactivatedAt) {
          throw new DeactivatedAccountError();
        }

        if (!user.emailVerified) {
          throw new UnverifiedEmailError();
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          await recordLoginFailure(email, ip);
          throw new InvalidCredentialsError();
        }

        // Successful login — clear any accumulated failures for this email+ip
        await clearLoginFailures(email, ip);

        return {
          id: user.id,
          email: user.email,
        };
      },
    }),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        if (!profile?.email) {
          return false;
        }

        // Security Rule 5: Google OAuth may only auto-link when email_verified is true
        const emailVerified = (profile as { email_verified?: boolean }).email_verified;
        if (!emailVerified) {
          return false;
        }

        const email = profile.email.toLowerCase();
        const existingUser = await prisma.user.findUnique({
          where: { email },
        });

        if (existingUser) {
          if (existingUser.deactivatedAt) {
            return false;
          }
          if (!existingUser.emailVerified) {
            await prisma.user.update({
              where: { id: existingUser.id },
              data: {
                emailVerified: new Date(),
                oauthProvider: "google",
                oauthId: account.providerAccountId,
              },
            });
          }
          user.id = existingUser.id;
        } else {
          const newUser = await prisma.user.create({
            data: {
              email,
              emailVerified: new Date(),
              oauthProvider: "google",
              oauthId: account.providerAccountId,
            },
          });
          user.id = newUser.id;
        }
      }
      return true;
    },
  },
});

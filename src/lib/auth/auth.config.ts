import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js configuration used by middleware.
 * Must NOT import Prisma, bcrypt, or any Node-only module.
 * The Node-only pieces (providers, prisma-backed callbacks) live in auth.ts.
 */
export const authConfig = {
  pages: {
    signIn: "/auth",
    error: "/auth",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const isOnDashboard = request.nextUrl.pathname.startsWith("/dashboard");

      if (isOnDashboard) {
        return isLoggedIn; // unauthenticated -> redirected to /auth
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
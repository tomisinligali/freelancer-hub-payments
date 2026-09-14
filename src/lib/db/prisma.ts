import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

declare global {
  var prismaGlobal: PrismaClient | undefined;
  var pgPoolGlobal: pg.Pool | undefined;
}

function createPgPool(): pg.Pool {
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10, // pool size per server instance
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

/**
 * Shared pg Pool: one per server instance, capped at 10 concurrent connections.
 */
export const pgPool = globalThis.pgPoolGlobal ?? createPgPool();

const prismaAdapter = new PrismaPg(pgPool);

/**
 * Raw Prisma client shared across the process. Never export this directly to
 * callers — use `prisma` (append-only enforced) or the scoped client.
 */
export const prismaBase =
  globalThis.prismaGlobal ?? new PrismaClient({ adapter: prismaAdapter });

// PaymentLog is the trusted audit layer: append-only by construction.
// State can only move forward; nobody can rewrite payment history.
export const prisma = prismaBase.$extends({
  query: {
    paymentLog: {
      update({ args: _args }) {
        void _args;
        return Promise.reject(
          new Error("PaymentLog is append-only. Update is not permitted."),
        );
      },
      updateMany({ args: _args }) {
        void _args;
        return Promise.reject(
          new Error("PaymentLog is append-only. updateMany is not permitted."),
        );
      },
      delete({ args: _args }) {
        void _args;
        return Promise.reject(
          new Error("PaymentLog is append-only. Delete is not permitted."),
        );
      },
      deleteMany({ args: _args }) {
        void _args;
        return Promise.reject(
          new Error("PaymentLog is append-only. deleteMany is not permitted."),
        );
      },
    },
  },
});

/** Same enforced client; kept for callers that name the intent explicitly. */
export const enforcementPrisma = prisma;

if (process.env.NODE_ENV !== "production") {
  globalThis.prismaGlobal = prismaBase;
  globalThis.pgPoolGlobal = pgPool;
}
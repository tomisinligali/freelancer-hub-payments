import type { Prisma } from "@prisma/client";
import { prismaBase } from "@/lib/db/prisma";

export type ScopedPrisma = ReturnType<typeof getScopedPrisma>;

type SubscriptionUniqueWhere = Prisma.SubscriptionWhereUniqueInput;
type SubscriptionCreateData = Prisma.SubscriptionUncheckedCreateInput;
type SubscriptionEventCreateData = Prisma.SubscriptionEventUncheckedCreateInput;
type CheckoutSessionCreateData = Prisma.CheckoutSessionUncheckedCreateInput;
type PaymentLogCreateData = Prisma.PaymentLogUncheckedCreateInput;

/**
 * Single ownership-enforcement point for every user-owned model in this slice.
 *
 * All Subscription, SubscriptionEvent, CheckoutSession, and payment-related
 * User reads/mutations must go through this scoped client. The userId is
 * derived from the authenticated server session; it is never taken from
 * client input.
 */
export function getScopedPrisma(userId: string) {
  return prismaBase.$extends({
    query: {
      user: {
        findUnique({ args, query }) {
          return query({ ...args, where: { ...args.where, id: userId } });
        },
        findFirst({ args, query }) {
          return query({ ...args, where: { ...args.where, id: userId } });
        },
        findMany({ args, query }) {
          return query({ ...args, where: { ...args.where, id: userId } });
        },
        update({ args, query }) {
          return query({ ...args, where: { ...args.where, id: userId } });
        },
        updateMany({ args, query }) {
          return query({ ...args, where: { ...args.where, id: userId } });
        },
        count({ args, query }) {
          return query({ ...args, where: { ...args.where, id: userId } });
        },
      },
      subscription: {
        findUnique({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        findFirst({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        findMany({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        create({ args, query }) {
          const data = args.data as SubscriptionCreateData;
          return query({
            ...args,
            data: { ...data, userId },
          } as Prisma.SubscriptionCreateArgs);
        },
        update({ args, query }) {
          return query({ ...args, where: { ...(args.where as SubscriptionUniqueWhere), userId } });
        },
        updateMany({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        upsert({ args, query }) {
          const create = args.create as SubscriptionCreateData;
          return query({
            ...args,
            where: { ...(args.where as SubscriptionUniqueWhere), userId },
            create: { ...create, userId },
          } as Prisma.SubscriptionUpsertArgs);
        },
        delete({ args, query }) {
          return query({ ...args, where: { ...(args.where as SubscriptionUniqueWhere), userId } });
        },
        deleteMany({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        count({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        aggregate({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
      },
      subscriptionEvent: {
        findUnique({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        findFirst({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        findMany({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        create({ args, query }) {
          const data = args.data as SubscriptionEventCreateData;
          return query({
            ...args,
            data: { ...data, userId },
          } as Prisma.SubscriptionEventCreateArgs);
        },
        count({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        aggregate({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
      },
      checkoutSession: {
        findUnique({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        findFirst({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        findMany({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        create({ args, query }) {
          const data = args.data as CheckoutSessionCreateData;
          return query({
            ...args,
            data: { ...data, userId },
          } as Prisma.CheckoutSessionCreateArgs);
        },
        update({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        updateMany({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        count({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
      },
      paymentLog: {
        findUnique({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        findFirst({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        findMany({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
        create({ args, query }) {
          const data = args.data as PaymentLogCreateData;
          return query({
            ...args,
            data: { ...data, userId },
          } as Prisma.PaymentLogCreateArgs);
        },
        count({ args, query }) {
          return query({ ...args, where: { ...args.where, userId } });
        },
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
}
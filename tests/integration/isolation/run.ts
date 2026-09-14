import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Plan } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getScopedPrisma } from "@/lib/db/scoped";
import { createSubscriptionService } from "@/lib/payments/subscription-service";
import type { PaymentProvider, CheckoutRequest, VerifiedTransaction } from "@/lib/payments/types";
import { addMonths } from "@/lib/payments/billing-math";

class FakeProvider implements PaymentProvider {
  createCheckoutCalls: CheckoutRequest[] = [];
  cancelledIds: string[] = [];

  constructor(private opts: { verifySuccess?: boolean; txStatus?: "successful" | "failed" | "pending" } = {}) {}

  async createCheckout(input: CheckoutRequest): Promise<string> {
    this.createCheckoutCalls.push(input);
    return `https://checkout.test/${input.txRef}`;
  }

  async verifyTransaction(): Promise<VerifiedTransaction> {
    const paid = this.createCheckoutCalls.at(-1)?.amount ?? 500_000;
    return {
      status: this.opts.txStatus ?? this.opts.verifySuccess === false ? "failed" : "successful",
      amount: paid,
      currency: "NGN",
      providerSubscriptionId: "sub_123",
    };
  }

  async cancelProviderSubscription(id: string): Promise<void> {
    this.cancelledIds.push(id);
  }
}

async function createTestUser(): Promise<string> {
  const email = `iso-${randomUUID()}@test.dev`;
  const user = await prisma.user.create({
    data: { email, emailVerified: new Date() },
  });
  return user.id;
}

async function destroyTestUser(userId: string): Promise<void> {
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
}

async function countEvents(userId: string, type: string): Promise<number> {
  return prisma.subscriptionEvent.count({ where: { userId, type } });
}

async function seedPeriod(userId: string, plan: Plan, periodEnd: Date) {
  const months = plan === "MONTHLY" ? 1 : 12;
  const periodStart = new Date(periodEnd.getTime() - months * 30 * 24 * 60 * 60 * 1000);
  await prisma.subscription.upsert({
    where: { userId },
    create: {
      userId,
      plan,
      status: "ACTIVE",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      providerSubscriptionId: "sub_123",
    },
    update: {
      plan,
      status: "ACTIVE",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      providerSubscriptionId: "sub_123",
    },
  });
  await prisma.user.update({ where: { id: userId }, data: { plan } });
}

let userIds: string[] = [];

before(async () => {
  userIds = [];
});

after(async () => {
  for (const id of userIds) {
    await destroyTestUser(id);
  }
});

test("subscribe to MONTHLY starts a checkout that hands off to the provider", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const provider = new FakeProvider();
  const service = createSubscriptionService(provider);

  const start = await service.initiateCheckout(userId, "SUBSCRIBE", "MONTHLY", "a@test.dev");
  assert.equal(start.intent, "SUBSCRIBE");
  assert.equal(start.plan, "MONTHLY");
  assert.ok(start.checkoutUrl.includes("checkout.test"));
  assert.ok((await countEvents(userId, "CHECKOUT_STARTED")) === 1);

  // No plan change until the provider confirms the payment.
  const view = await service.getView(userId);
  assert.equal(view.plan, "FREE");
});

test("finalizeFromWebhook applies the subscribe after a successful verification", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const provider = new FakeProvider();
  const service = createSubscriptionService(provider);

  const checkout = await service.initiateCheckout(userId, "SUBSCRIBE", "MONTHLY", "a@test.dev");
  const txRef = checkout.checkoutUrl.split("/").pop() ?? "";

  const result = await service.finalizeFromWebhook(userId, txRef, "tx_123");
  assert.equal(result.status, "COMPLETED");

  const view = await service.getView(userId);
  assert.equal(view.plan, "MONTHLY");
  assert.equal(view.hasPaidPlan, true);
  assert.equal(view.canUpgrade, true);
  assert.ok(view.currentPeriodEnd);
  assert.ok((await countEvents(userId, "PAYMENT_VERIFIED")) >= 1);

  // The thing being sold is a plan flag on the user record.
  const user = await prisma.user.findUnique({ where: { id: userId } });
  assert.equal(user?.plan, "MONTHLY");
});

test("processReturn verifies but does not apply the plan change (return page path)", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const provider = new FakeProvider();
  const service = createSubscriptionService(provider);

  const checkout = await service.initiateCheckout(userId, "SUBSCRIBE", "MONTHLY", "a@test.dev");
  const txRef = checkout.checkoutUrl.split("/").pop() ?? "";

  const result = await service.processReturn(userId, txRef, "tx_101");
  assert.equal(result.status, "PENDING");
  assert.equal(result.ok, true);

  const view = await service.getView(userId);
  assert.equal(view.plan, "FREE", "plan is not changed by the return page path");

  // Webhook finalizes it.
  const finalResult = await service.finalizeFromWebhook(userId, txRef, "tx_101");
  assert.equal(finalResult.status, "COMPLETED");

  const finalView = await service.getView(userId);
  assert.equal(finalView.plan, "MONTHLY");
});

test("upgrade mid-cycle charges a prorated amount and sets the yearly period", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const provider = new FakeProvider();
  const service = createSubscriptionService(provider);

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000); // ~mid-period
  const periodStart = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, plan: "MONTHLY", status: "ACTIVE", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
    update: { plan: "MONTHLY", status: "ACTIVE", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
  });
  await prisma.user.update({ where: { id: userId }, data: { plan: "MONTHLY" } });

  const checkout = await service.initiateCheckout(userId, "UPGRADE", "YEARLY", "a@test.dev");
  const txRef = checkout.checkoutUrl.split("/").pop() ?? "";
  assert.ok(checkout.amount < 5_000_000, `prorated charge ${checkout.amount}`);
  assert.ok(checkout.amount > 0);

  const result = await service.finalizeFromWebhook(userId, txRef, "tx_456");
  assert.equal(result.status, "COMPLETED");

  const view = await service.getView(userId);
  assert.equal(view.plan, "YEARLY");
  assert.equal(view.canDowngrade, true);
  assert.ok((await countEvents(userId, "UPGRADE_PAID")) >= 1);

  // Option 2: the yearly period runs a full 12 months from the upgrade date,
  // not anchored to the original monthly start.
  assert.ok(view.currentPeriodEnd, "yearly period end is set");
  const expectedEnd = addMonths(now, 12);
  const diffMs = Math.abs(view.currentPeriodEnd.getTime() - expectedEnd.getTime());
  assert.ok(diffMs <= 2 * 24 * 60 * 60 * 1000, `period end ~12 months from now (${diffMs}ms off)`);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  assert.equal(user?.plan, "YEARLY");
});

test("upgrade near the end of the monthly period is blocked with a clear message", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const provider = new FakeProvider();
  const service = createSubscriptionService(provider);

  const now = new Date();
  // ~29 days into a 30-day period -> fraction < 0.05
  const periodEnd = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
  const periodStart = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, plan: "MONTHLY", status: "ACTIVE", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
    update: { plan: "MONTHLY", status: "ACTIVE", currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
  });
  await prisma.user.update({ where: { id: userId }, data: { plan: "MONTHLY" } });

  await assert.rejects(
    () => service.initiateCheckout(userId, "UPGRADE", "YEARLY", "a@test.dev"),
    (err: unknown) =>
      err instanceof Error &&
      /ends/.test(err.message) &&
      /full yearly price/.test(err.message),
  );
  assert.equal(provider.createCheckoutCalls.length, 0, "no checkout is created");
});

test("downgrade is applied only at the end of the current period", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const provider = new FakeProvider();
  const service = createSubscriptionService(provider);

  await seedPeriod(userId, "YEARLY", addMonths(new Date(), 40)); // plenty of days left
  const serviceView = await service.getView(userId);
  assert.equal(serviceView.plan, "YEARLY");

  await service.requestDowngrade(userId);
  const beforeEnd = await service.getView(userId);
  assert.equal(beforeEnd.plan, "YEARLY", "plan unchanged before period end");
  assert.equal(beforeEnd.pendingDowngradeTo, "MONTHLY");
  assert.ok((await countEvents(userId, "DOWNGRADE_SCHEDULED")) >= 1);

  // Force the period to end; the next read applies the downgrade.
  await seedPeriod(userId, "YEARLY", new Date(Date.now() - 1000));
  const afterEnd = await service.getView(userId);
  assert.equal(afterEnd.plan, "MONTHLY");
  assert.equal(afterEnd.pendingDowngradeTo, null);
  assert.ok((await countEvents(userId, "DOWNGRADE_APPLIED")) >= 1);
});

test("cancel keeps access until the paid period ends, then returns to FREE", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const provider = new FakeProvider();
  const service = createSubscriptionService(provider);

  await seedPeriod(userId, "MONTHLY", addMonths(new Date(), 25));
  await service.requestCancel(userId);

  const beforeEnd = await service.getView(userId);
  assert.equal(beforeEnd.plan, "MONTHLY", "access retained until period end");
  assert.equal(beforeEnd.cancelAtPeriodEnd, true);

  // Period ends.
  await seedPeriod(userId, "MONTHLY", new Date(Date.now() - 1000));
  const afterEnd = await service.getView(userId);
  assert.equal(afterEnd.plan, "FREE");
  assert.equal(afterEnd.cancelAtPeriodEnd, false);
  assert.ok((await countEvents(userId, "CANCELLED_AT_PERIOD_END")) >= 1);
});

test("cancel stores an optional cancellation reason on the subscription and in the event", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const provider = new FakeProvider();
  const service = createSubscriptionService(provider);

  await seedPeriod(userId, "YEARLY", addMonths(new Date(), 15));
  await service.requestCancel(userId, "Too expensive");
  const sub = await prisma.subscription.findUnique({ where: { userId } });
  assert.equal(sub?.cancellationReason, "Too expensive");

  const events = await prisma.subscriptionEvent.findMany({
    where: { userId, type: "CANCELLED" },
    select: { details: true },
  });
  const last = events.at(-1);
  assert.ok(last?.details?.includes("Too expensive"), "reason appears in the event");

  // A cancel without reason stores null.
  const userId2 = await createTestUser();
  userIds.push(userId2);
  await seedPeriod(userId2, "MONTHLY", addMonths(new Date(), 10));
  await service.requestCancel(userId2);
  const sub2 = await prisma.subscription.findUnique({ where: { userId: userId2 } });
  assert.equal(sub2?.cancellationReason, null);
});

test("scheduleResubscribe requires a cancelled plan", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const service = createSubscriptionService(new FakeProvider());
  await seedPeriod(userId, "MONTHLY", addMonths(new Date(), 25));
  await assert.rejects(() => service.scheduleResubscribe(userId, "YEARLY"), /renews automatically/);
});

test("scheduleResubscribe schedules the new plan and clears downgrade/cancel interactions", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const service = createSubscriptionService(new FakeProvider());
  const end = addMonths(new Date(), 25);
  await seedPeriod(userId, "YEARLY", end);
  await service.requestCancel(userId);
  await service.scheduleResubscribe(userId, "MONTHLY");
  const view = await service.getView(userId);
  assert.equal(view.pendingResubscribeTo, "MONTHLY");
  assert.equal(view.cancelAtPeriodEnd, true);
  assert.ok((await countEvents(userId, "RESUBSCRIBE_SCHEDULED")) >= 1);
});

test("scheduled resubscribe opens a payment at period end and only applies once paid", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const provider = new FakeProvider();
  const service = createSubscriptionService(provider);
  const end = addMonths(new Date(), 25);
  await seedPeriod(userId, "YEARLY", end);
  await service.requestCancel(userId);
  await service.scheduleResubscribe(userId, "MONTHLY");
  // Force the period to end.
  await seedPeriod(userId, "YEARLY", new Date(Date.now() - 1000));

  const pending = await service.getView(userId);
  assert.equal(pending.plan, "YEARLY", "old plan is not silently replaced");
  assert.equal(pending.status, "PAST_DUE", "payment is pending");
  assert.equal(pending.cancelAtPeriodEnd, true);
  assert.equal(pending.pendingResubscribeTo, "MONTHLY");
  assert.ok(pending.pendingResubscribeCheckoutUrl, "a checkout is opened to pay");
  assert.equal(provider.createCheckoutCalls.length, 1);
  assert.equal(provider.createCheckoutCalls[0].plan, "MONTHLY");
  assert.equal(provider.createCheckoutCalls[0].amount, 500_000); // ₦5,000 in kobo
  assert.ok((await countEvents(userId, "RESUBSCRIBE_PAYMENT_STARTED")) >= 1);

  // A second read must not open a second checkout.
  await service.getView(userId);
  assert.equal(provider.createCheckoutCalls.length, 1);

  // The webhook finalizes the payment.
  const txRef = provider.createCheckoutCalls[0].txRef;
  const result = await service.finalizeFromWebhook(userId, txRef, "tx_r1");
  assert.equal(result.status, "COMPLETED");
  const active = await service.getView(userId);
  assert.equal(active.plan, "MONTHLY");
  assert.equal(active.status, "ACTIVE");
  assert.equal(active.cancelAtPeriodEnd, false);
  assert.equal(active.pendingResubscribeTo, null);
  assert.equal(active.pendingResubscribeCheckoutUrl, null);
  assert.ok((await countEvents(userId, "RESUBSCRIBE_APPLIED")) >= 1);
});

test("a failed resubscribe payment can be retried with a fresh checkout", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const provider = new FakeProvider({ txStatus: "failed" });
  const service = createSubscriptionService(provider);
  await seedPeriod(userId, "YEARLY", addMonths(new Date(), 25));
  await service.requestCancel(userId);
  await service.scheduleResubscribe(userId, "MONTHLY");
  await seedPeriod(userId, "YEARLY", new Date(Date.now() - 1000));
  await service.getView(userId);
  assert.equal(provider.createCheckoutCalls.length, 1);
  const firstRef = provider.createCheckoutCalls[0].txRef;

  const failed = await service.finalizeFromWebhook(userId, firstRef, "tx_f1");
  assert.equal(failed.status, "FAILED");

  const retry = await service.getResubscribeCheckout(userId);
  assert.ok(retry.checkoutUrl);
  assert.equal(provider.createCheckoutCalls.length, 2, "a fresh checkout is opened after the failed one");
});

test("initiateCheckout refuses SUBSCRIBE for an active or cancelled paid user", async () => {
  const provider = new FakeProvider();
  const service = createSubscriptionService(provider);

  const userId = await createTestUser();
  userIds.push(userId);
  await seedPeriod(userId, "MONTHLY", addMonths(new Date(), 25));
  await service.requestCancel(userId);
  await assert.rejects(() => service.initiateCheckout(userId, "SUBSCRIBE", "MONTHLY", "a@test.dev"), /already scheduled/);
  await assert.rejects(() => service.initiateCheckout(userId, "SUBSCRIBE", "YEARLY", "a@test.dev"), /already scheduled/);

  const activeUserId = await createTestUser();
  userIds.push(activeUserId);
  await seedPeriod(activeUserId, "MONTHLY", addMonths(new Date(), 25));
  await assert.rejects(() => service.initiateCheckout(activeUserId, "SUBSCRIBE", "YEARLY", "a@test.dev"), /Upgrade/);
  await assert.rejects(() => service.initiateCheckout(activeUserId, "SUBSCRIBE", "MONTHLY", "a@test.dev"), /already on the monthly plan/);

  assert.equal(provider.createCheckoutCalls.length, 0, "no checkout is created for blocked SUBSCRIBE intents");
});

test("scheduleResubscribe overwrites an earlier scheduled resubscribe (newest intent wins)", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const service = createSubscriptionService(new FakeProvider());
  await seedPeriod(userId, "MONTHLY", addMonths(new Date(), 25));
  await service.requestCancel(userId);
  await service.scheduleResubscribe(userId, "YEARLY");
  await service.scheduleResubscribe(userId, "MONTHLY");
  const view = await service.getView(userId);
  assert.equal(view.pendingResubscribeTo, "MONTHLY", "later schedule overwrites the earlier one");
});

test("cross-user isolation: one user cannot read another user's subscription", async () => {
  const userAName = createTestUser();
  const userBName = createTestUser();
  const [userA, userB] = await Promise.all([userAName, userBName]);
  userIds.push(userA, userB);

  await seedPeriod(userA, "MONTHLY", addMonths(new Date(), 25));

  // user B's scoped client must not see A's subscription or events.
  const bDb = getScopedPrisma(userB);
  const bSubscriptions = await bDb.subscription.findMany();
  assert.equal(bSubscriptions.length, 0);

  const bUser = await bDb.user.findUnique({ where: { id: userB } });
  assert.equal(bUser?.plan, "FREE");

  const bEvents = await bDb.subscriptionEvent.findMany();
  assert.equal(bEvents.length, 0);

  // A's subscription cannot be mutated through B's scope.
  const aSub = await prisma.subscription.findUnique({ where: { userId: userA } });
  assert.ok(aSub);
  const bUpdate = await bDb.subscription.updateMany({
    where: { id: aSub.id },
    data: { plan: "YEARLY" },
  });
  assert.equal(bUpdate.count, 0);
});

test("provider verification gates the state change", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const provider = new FakeProvider({ txStatus: "failed" });
  const service = createSubscriptionService(provider);

  await seedPeriod(userId, "MONTHLY", addMonths(new Date(), 25));
  const checkout = await service.initiateCheckout(userId, "UPGRADE", "YEARLY", "a@test.dev");
  const txRef = checkout.checkoutUrl.split("/").pop() ?? "";

  const result = await service.processReturn(userId, txRef, "tx_789");
  assert.equal(result.ok, false);

  const view = await service.getView(userId);
  assert.equal(view.plan, "MONTHLY", "plan unchanged when verification fails");

  const user = await prisma.user.findUnique({ where: { id: userId } });
  assert.equal(user?.plan, "MONTHLY");
});

test("payment log records the full verified journey in order", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const provider = new FakeProvider();
  const service = createSubscriptionService(provider);

  const checkout = await service.initiateCheckout(userId, "SUBSCRIBE", "MONTHLY", "a@test.dev");
  const txRef = checkout.checkoutUrl.split("/").pop() ?? "";

  const logTypes = async () =>
    (await prisma.paymentLog.findMany({ where: { userId }, select: { type: true } })).map(
      (l) => l.type,
    );

  assert.deepEqual(await logTypes(), ["CHECKOUT_INITIATED"]);

  const result = await service.finalizeFromWebhook(userId, txRef, "tx_111");
  assert.equal(result.status, "COMPLETED");

  const types = await logTypes();
  assert.deepEqual(types, [
    "CHECKOUT_INITIATED",
    "PROVIDER_RETURN",
    "VERIFY_REQUESTED",
    "VERIFY_COMPLETED",
    "STATE_CHANGED",
  ]);

  const last = await prisma.paymentLog.findFirst({
    where: { userId, type: "STATE_CHANGED" },
  });
  assert.equal(last?.verificationStatus, "SUCCESSFUL");
  assert.equal(last?.plan, "MONTHLY");
  assert.equal(last?.amount, 500_000); // kobo
});

test("forged return params are logged but never trusted", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const provider = new FakeProvider({ txStatus: "failed" });
  const service = createSubscriptionService(provider);

  const checkout = await service.initiateCheckout(userId, "SUBSCRIBE", "MONTHLY", "a@test.dev");
  const txRef = checkout.checkoutUrl.split("/").pop() ?? "";

  // The attacker claims success; verification reports failed, so nothing changes.
  const result = await service.processReturn(
    userId,
    txRef,
    "tx_222",
    { status: "successful", tx_ref: txRef },
  );
  assert.equal(result.ok, false);
  assert.equal((await service.getView(userId)).plan, "FREE");

  const entries = await prisma.paymentLog.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  const returnPayload = entries[1].rawPayload as { status?: string } | null;
  assert.equal(entries[1].type, "PROVIDER_RETURN");
  assert.equal(returnPayload?.status, "successful");
  assert.equal(entries[1].verificationStatus, "UNVERIFIED");
  assert.equal(entries.at(-1)?.type, "VERIFY_COMPLETED");
  assert.equal(entries.at(-1)?.verificationStatus, "FAILED");
});

test("payment log is append-only: updates and deletes are rejected", async () => {
  const userId = await createTestUser();
  userIds.push(userId);
  const provider = new FakeProvider();
  const service = createSubscriptionService(provider);

  await service.initiateCheckout(userId, "SUBSCRIBE", "MONTHLY", "a@test.dev");
  const log = await prisma.paymentLog.findFirst({ where: { userId } });
  assert.ok(log);

  await assert.rejects(
    prisma.paymentLog.update({ where: { id: log.id }, data: { message: "tampered" } }),
    /append-only/,
  );
  await assert.rejects(
    prisma.paymentLog.delete({ where: { id: log.id } }),
    /append-only/,
  );
  await assert.rejects(
    prisma.paymentLog.updateMany({ where: { userId }, data: { message: "tampered" } }),
    /append-only/,
  );

  // The log row is untouched.
  const after = await prisma.paymentLog.findUnique({ where: { id: log.id } });
  assert.equal(after?.message, null);
});

test("payment log is scoped per user and cannot be written as another user", async () => {
  const userA = await createTestUser();
  const userB = await createTestUser();
  userIds.push(userA, userB);

  const provider = new FakeProvider();
  const service = createSubscriptionService(provider);
  await service.initiateCheckout(userA, "SUBSCRIBE", "MONTHLY", "a@test.dev");

  const aLogs = await prisma.paymentLog.count({ where: { userId: userA } });
  assert.ok(aLogs >= 1);

  // B's scoped client sees none of A's log.
  const bDb = getScopedPrisma(userB);
  assert.equal(await bDb.paymentLog.count(), 0);

  // A log written through B's scope is attributed to B, not the spoofed A
  // from the caller — the scope always owns the userId.
  await bDb.paymentLog.create({
    data: {
      userId: userA,
      type: "ERROR",
      source: "SYSTEM",
      message: "B wrote this",
    },
  });
  const written = await prisma.paymentLog.findUnique({
    where: { id: (await prisma.paymentLog.findFirst({ where: { userId: userB } }))?.id ?? "" },
  });
  assert.ok(written);
  assert.equal(written.userId, userB);
});
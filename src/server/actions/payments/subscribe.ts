"use server";

import type { Plan } from "@prisma/client";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createSubscriptionService } from "@/lib/payments/subscription-service";
import { flutterwaveProvider } from "@/lib/payments/flutterwave/provider";
import type { CheckoutResult } from "@/lib/payments/subscription-service";

export type SubscribeActionState =
  | { ok: true; checkout: CheckoutResult }
  | { ok: false; error: string };

export async function subscribeAction(plan: Plan): Promise<SubscribeActionState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in to subscribe." };
  }

  if (plan !== "MONTHLY" && plan !== "YEARLY") {
    return { ok: false, error: "Choose the monthly or yearly plan." };
  }

  // Guard against a stale session: the JWT may reference a user row that no
  // longer exists (e.g. after a database reset). Fail clearly instead of
  // throwing a foreign-key error from the checkout insert.
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) {
    return {
      ok: false,
      error: "Account not found. Please sign out and sign in again.",
    };
  }

  try {
    const service = createSubscriptionService(flutterwaveProvider);
    const checkout = await service.initiateCheckout(
      session.user.id,
      "SUBSCRIBE",
      plan,
      session.user.email ?? "",
    );
    return { ok: true, checkout };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Checkout could not be started." };
  }
}
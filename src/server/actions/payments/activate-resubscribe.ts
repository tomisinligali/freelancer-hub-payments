"use server";

import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createSubscriptionService } from "@/lib/payments/subscription-service";
import { flutterwaveProvider } from "@/lib/payments/flutterwave/provider";
import type { Plan } from "@prisma/client";

export type ActivateResubscribeActionState =
  | { ok: true; checkoutUrl: string; plan: Plan }
  | { ok: false; error: string };

export async function activateResubscribeAction(): Promise<ActivateResubscribeActionState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in to pay." };
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) {
    return {
      ok: false,
      error: "Account not found. Please sign out and sign in again.",
    };
  }

  try {
    const service = createSubscriptionService(flutterwaveProvider);
    const result = await service.getResubscribeCheckout(session.user.id);
    return { ok: true, checkoutUrl: result.checkoutUrl, plan: result.plan };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Payment could not be started." };
  }
}
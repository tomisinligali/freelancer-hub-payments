"use server";

import type { Plan } from "@prisma/client";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createSubscriptionService } from "@/lib/payments/subscription-service";
import { flutterwaveProvider } from "@/lib/payments/flutterwave/provider";

export type ScheduleResubscribeActionState =
  | { ok: true }
  | { ok: false; error: string };

export async function scheduleResubscribeAction(
  plan: Plan,
): Promise<ScheduleResubscribeActionState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in to schedule a re-subscription." };
  }

  if (plan !== "MONTHLY" && plan !== "YEARLY") {
    return { ok: false, error: "Choose the monthly or yearly plan." };
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
    await service.scheduleResubscribe(session.user.id, plan);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The re-subscription could not be scheduled." };
  }
}
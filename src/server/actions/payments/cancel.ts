"use server";

import { auth } from "@/lib/auth/auth";
import { createSubscriptionService } from "@/lib/payments/subscription-service";
import { flutterwaveProvider } from "@/lib/payments/flutterwave/provider";

export type CancelActionState = { ok: true } | { ok: false; error: string };

export async function cancelAction(reason?: string): Promise<CancelActionState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in to cancel." };
  }

  try {
    const service = createSubscriptionService(flutterwaveProvider);
    await service.requestCancel(session.user.id, reason?.slice(0, 500));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Cancellation could not be scheduled." };
  }
}
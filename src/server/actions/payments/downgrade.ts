"use server";

import { auth } from "@/lib/auth/auth";
import { createSubscriptionService } from "@/lib/payments/subscription-service";
import { flutterwaveProvider } from "@/lib/payments/flutterwave/provider";

export type DowngradeActionState = { ok: true } | { ok: false; error: string };

export async function downgradeAction(): Promise<DowngradeActionState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in to downgrade." };
  }

  try {
    const service = createSubscriptionService(flutterwaveProvider);
    await service.requestDowngrade(session.user.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Downgrade could not be scheduled." };
  }
}
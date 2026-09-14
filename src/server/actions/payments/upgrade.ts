"use server";

import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createSubscriptionService } from "@/lib/payments/subscription-service";
import { flutterwaveProvider } from "@/lib/payments/flutterwave/provider";
import type { CheckoutResult } from "@/lib/payments/subscription-service";

export type UpgradeActionState =
  | { ok: true; checkout: CheckoutResult }
  | { ok: false; error: string };

export async function upgradeAction(): Promise<UpgradeActionState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "You must be signed in to upgrade." };
  }

  // Guard against a stale session (see subscribeAction).
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
      "UPGRADE",
      "YEARLY",
      session.user.email ?? "",
    );
    return { ok: true, checkout };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Upgrade could not be started." };
  }
}
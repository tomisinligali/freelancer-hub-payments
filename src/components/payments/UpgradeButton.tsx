"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { upgradeAction } from "@/server/actions/payments/upgrade";

interface UpgradeButtonProps {
  children?: React.ReactNode;
  /** Prorated charge in kobo, shown before the upgrade is confirmed. */
  proratedChargeKobo?: number | null;
}

function formatKobo(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function UpgradeButton({ children, proratedChargeKobo }: UpgradeButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function startUpgrade() {
    setError(null);
    if (proratedChargeKobo != null && proratedChargeKobo > 0) {
      setConfirming(true);
      return;
    }
    upgrade();
  }

  function upgrade() {
    setError(null);
    startTransition(async () => {
      const result = await upgradeAction();
      if (result.ok) {
        window.location.href = result.checkout.checkoutUrl;
      } else {
        setConfirming(false);
        setError(result.error);
      }
    });
  }

  if (confirming) {
    return (
      <div className="fh-upgrade-confirm">
        <p className="fh-plan-note">
          Switching to Yearly now. You keep the unused value of your current month as
          credit, so you&apos;ll be charged {formatKobo(proratedChargeKobo ?? 0)} today
          and your yearly period starts now.
        </p>
        <div className="fh-cancel-reason-actions">
          <Button variant="secondary" disabled={isPending} onClick={() => setConfirming(false)}>
            Not now
          </Button>
          <Button disabled={isPending} onClick={upgrade} isLoading={isPending}>
            Pay {formatKobo(proratedChargeKobo ?? 0)} now
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Button onClick={startUpgrade} isLoading={isPending}>
        {children ?? "Upgrade to Yearly"}
      </Button>
      {error ? <p className="fh-message fh-message--error">{error}</p> : null}
    </div>
  );
}
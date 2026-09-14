"use client";

import React, { useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { downgradeAction } from "@/server/actions/payments/downgrade";
import { cancelAction } from "@/server/actions/payments/cancel";

interface BillingActionsProps {
  allowDowngrade: boolean;
  allowCancel: boolean;
  cancelScheduled: boolean;
}

export function BillingActions({ allowDowngrade, allowCancel, cancelScheduled }: BillingActionsProps) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = React.useState<string | null>(null);
  const [isError, setIsError] = React.useState(false);
  const [confirmingCancel, setConfirmingCancel] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState("");

  function confirmCancel() {
    setMessage(null);
    startTransition(async () => {
      const result = await cancelAction(cancelReason);
      if (!result.ok) {
        setIsError(true);
        setMessage(result.error ?? "Something went wrong.");
      } else {
        setConfirmingCancel(false);
        setIsError(false);
        setMessage(
          cancelReason
            ? `Cancellation scheduled — you keep access until the end of your paid period. Reason recorded: "${cancelReason}"`
            : "Cancellation scheduled — you keep access until the end of your paid period.",
        );
      }
    });
  }

  return (
    <div className="fh-billing-actions">
      {allowDowngrade ? (
        <Button variant="secondary" disabled={isPending} onClick={() => run(downgradeAction)}>
          Schedule downgrade to Monthly
        </Button>
      ) : null}

      {allowCancel && !cancelScheduled ? (
        confirmingCancel ? (
          <div className="fh-cancel-reason">
            <label className="fh-cancel-reason-label" htmlFor="cancel-reason">
              Why are you cancelling? (optional)
            </label>
            <textarea
              id="cancel-reason"
              className="fh-cancel-reason-input"
              rows={3}
              placeholder="Tell us what you didn't like…"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            {cancelReason ? (
              <p className="fh-message fh-message--info fh-cancel-reason-echo">
                You wrote: “{cancelReason}”
              </p>
            ) : null}
            <div className="fh-cancel-reason-actions">
              <Button variant="secondary" disabled={isPending} onClick={() => setConfirmingCancel(false)}>
                Keep subscription
              </Button>
              <Button disabled={isPending} onClick={confirmCancel} isLoading={isPending}>
                Confirm cancellation
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" disabled={isPending} onClick={() => setConfirmingCancel(true)}>
            Cancel subscription
          </Button>
        )
      ) : null}

      {message ? (
        <div className={`fh-message ${isError ? "fh-message--error" : "fh-message--info"}`} role="alert">
          <span>{message}</span>
        </div>
      ) : null}
    </div>
  );

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setIsError(true);
        setMessage(result.error ?? "Something went wrong.");
      }
    });
  }
}
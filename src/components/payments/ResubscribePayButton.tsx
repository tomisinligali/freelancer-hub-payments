"use client";

import React, { useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { activateResubscribeAction } from "@/server/actions/payments/activate-resubscribe";
import type { Plan } from "@prisma/client";

interface ResubscribePayButtonProps {
  plan: Plan;
  started: boolean;
}

export function ResubscribePayButton({ plan, started }: ResubscribePayButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = React.useState<string | null>(null);
  const [isError, setIsError] = React.useState(false);

  function go() {
    setMessage(null);
    startTransition(async () => {
      const result = await activateResubscribeAction();
      if (!result.ok) {
        setIsError(true);
        setMessage(result.error ?? "Payment could not be started.");
        return;
      }
      window.location.href = result.checkoutUrl;
    });
  }

  const planName = plan.charAt(0) + plan.slice(1).toLowerCase();

  return (
    <div className="fh-resubscribe-pay">
      <Button onClick={go} isLoading={isPending}>
        {started
          ? "Retry payment — activate " + planName + " plan"
          : "Start payment — activate " + planName + " plan"}
      </Button>
      {message ? (
        <div className={`fh-message ${isError ? "fh-message--error" : "fh-message--info"}`} role="alert">
          <span>{message}</span>
        </div>
      ) : null}
    </div>
  );
}
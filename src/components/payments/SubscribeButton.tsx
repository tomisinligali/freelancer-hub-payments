"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { subscribeAction } from "@/server/actions/payments/subscribe";
import type { Plan } from "@prisma/client";

interface SubscribeButtonProps {
  plan: Plan;
  label?: string;
}

export function SubscribeButton({ plan, label = "Subscribe" }: SubscribeButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await subscribeAction(plan);
      if (result.ok) {
        window.location.href = result.checkout.checkoutUrl;
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div>
      <Button onClick={handleClick} isLoading={isPending}>
        {label}
      </Button>
      {error ? <p className="fh-message fh-message--error">{error}</p> : null}
    </div>
  );
}
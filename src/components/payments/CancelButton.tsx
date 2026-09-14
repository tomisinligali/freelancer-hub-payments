"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { cancelAction } from "@/server/actions/payments/cancel";

export function CancelButton() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleClick() {
    setMessage(null);
    startTransition(async () => {
      const result = await cancelAction();
      if (result.ok) {
        setMessage("Cancellation scheduled. You keep access until the end of your billing period.");
      } else {
        setMessage(result.error);
      }
    });
  }

  return (
    <div>
      <Button variant="secondary" onClick={handleClick} isLoading={isPending}>
        Downgrade plan
      </Button>
      {message ? <p className="fh-message fh-message--info">{message}</p> : null}
    </div>
  );
}
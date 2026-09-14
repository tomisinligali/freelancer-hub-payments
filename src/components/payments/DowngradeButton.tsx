"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { downgradeAction } from "@/server/actions/payments/downgrade";

const LOSSES = [
  "Discounted yearly pricing — save ₦10,000",
  "Two months free compared to paying monthly",
];

export function DowngradeButton() {
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  function confirm() {
    setOpen(false);
    startTransition(async () => {
      const result = await downgradeAction();
      if (result.ok) {
        setIsError(false);
        setMessage("Downgrade scheduled for the end of your billing period.");
      } else {
        setIsError(true);
        setMessage(result.error);
      }
    });
  }

  return (
    <div>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Downgrade plan
      </Button>

      {open ? (
        <div
          className="fh-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="downgrade-modal-title"
        >
          <div className="fh-modal-card">
            <h2 id="downgrade-modal-title" className="fh-upgrade-modal-title">
              Are you sure you want to downgrade?
            </h2>
            <p className="fh-modal-description">
              The change applies at the end of your current billing period. You keep yearly
              access until then. When you switch to Monthly you will lose:
            </p>
            <ul className="fh-downgrade-losses">
              {LOSSES.map((loss) => (
                <li key={loss}>{loss}</li>
              ))}
            </ul>
            <div className="fh-modal-actions">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Not now
              </Button>
              <Button onClick={confirm}>Confirm downgrade</Button>
            </div>
          </div>
        </div>
      ) : null}

      {message ? (
        <p className={`fh-message ${isError ? "fh-message--error" : "fh-message--info"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
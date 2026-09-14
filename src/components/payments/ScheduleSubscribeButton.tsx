"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { scheduleResubscribeAction } from "@/server/actions/payments/schedule-resubscribe";
import type { Plan } from "@prisma/client";

const PLAN_NAMES: Record<Plan, string> = {
  FREE: "Free",
  MONTHLY: "Monthly",
  YEARLY: "Yearly",
};

interface ScheduleSubscribeButtonProps {
  plan: Plan;                        // the plan to schedule
  currentPlan: Plan;                 // the plan the user is on now
  periodEnd: Date | null;            // when the current plan ends
  label: string;                     // e.g. "Schedule Monthly after my plan ends"
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function ScheduleSubscribeButton({
  plan,
  currentPlan,
  periodEnd,
  label,
}: ScheduleSubscribeButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const planName = PLAN_NAMES[plan];
  const currentPlanName = PLAN_NAMES[currentPlan];

  function confirm() {
    setMessage(null);
    setIsError(false);
    startTransition(async () => {
      const result = await scheduleResubscribeAction(plan);
      if (result.ok && periodEnd) {
        setOpen(false);
        setIsError(false);
        setMessage(
          `Scheduled — ${planName} will start on ${formatDate(periodEnd)}.`,
        );
      } else if (result.ok) {
        setOpen(false);
        setIsError(false);
        setMessage(`Scheduled — ${planName} will start when your current plan ends.`);
      } else {
        setIsError(true);
        setMessage(result.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <div className="fh-schedule-subscribe">
      {open ? (
        <div className="fh-schedule-subscribe-confirm">
          <p className="fh-plan-note">
            Your {currentPlanName} runs until{" "}
            {periodEnd ? formatDate(periodEnd) : "the end of your current period"}.{" "}
            {planName} will start right after that, and you will only be charged
            when it begins.
          </p>
          <div className="fh-cancel-reason-actions">
            <Button variant="secondary" disabled={isPending} onClick={() => setOpen(false)}>
              Not now
            </Button>
            <Button disabled={isPending} onClick={confirm} isLoading={isPending}>
              Schedule it
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" disabled={isPending} onClick={() => setOpen(true)}>
          {label}
        </Button>
      )}

      {message ? (
        <div
          className={`fh-message ${isError ? "fh-message--error" : "fh-message--success"}`}
          role="alert"
        >
          <span>{message}</span>
        </div>
      ) : null}
    </div>
  );
}
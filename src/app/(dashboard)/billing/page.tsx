import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { createSubscriptionService } from "@/lib/payments/subscription-service";
import { flutterwaveProvider } from "@/lib/payments/flutterwave/provider";
import { getPlan } from "@/lib/payments/plans";
import { formatMoney } from "@/lib/payments/types";
import { BillingActions } from "@/components/payments/BillingActions";
import { ResubscribePayButton } from "@/components/payments/ResubscribePayButton";

export const metadata = {
  title: "Billing | Freelancer Hub",
};

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function BillingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth?view=signin");
  }

  const service = createSubscriptionService(flutterwaveProvider);
  const view = await service.getView(session.user.id);
  const plan = getPlan(view.plan);

  const renewsOn = view.currentPeriodEnd
    ? view.cancelAtPeriodEnd || view.pendingDowngradeTo || view.pendingResubscribeTo
      ? "Access ends on"
      : "Renews on"
    : null;

  const rows: { label: string; value: ReactNode }[] = [
    { label: "Plan", value: plan.name },
    {
      label: "Status",
      value: view.cancelAtPeriodEnd ? "Cancelling at period end" : view.status === "PAST_DUE" ? "Renewal pending" : "Active",
    },
    {
      label: "Price",
      value: view.hasPaidPlan ? formatMoney(plan.price) : "$0.00",
    },
    {
      label: renewsOn ?? "Current period ends",
      value: formatDate(view.currentPeriodEnd),
    },
  ];

  if (view.pendingDowngradeTo) {
    rows.push({
      label: "Downgrade scheduled",
      value: `Changes to ${getPlan(view.pendingDowngradeTo).name} at the end of your current period`,
    });
  }

  if (view.pendingResubscribeTo) {
    rows.push({
      label: "Next subscription",
      value: `${getPlan(view.pendingResubscribeTo).name} starts after your current period ends`,
    });
  }

  return (
    <div className="fh-page">
      <div className="fh-page-heading">
        <h1 className="fh-auth-title">Billing</h1>
        <p className="fh-dashboard-greeting">Manage your subscription.</p>
      </div>

      <div className="fh-billing-card">
        {view.cancelAtPeriodEnd ? (
          <p className="fh-message fh-message--info">
            Cancellation is scheduled — you keep {plan.name} access until your period ends.
          </p>
        ) : null}

        <dl className="fh-billing-rows">
          {rows.map((row) => (
            <div className="fh-billing-row" key={row.label}>
              <dt className="fh-billing-row-label">{row.label}</dt>
              <dd className="fh-billing-row-value">{row.value}</dd>
            </div>
          ))}
        </dl>

        <div className="fh-billing-actions-row">
          {view.pendingResubscribeTo ? (
            <ResubscribePayButton
              plan={view.pendingResubscribeTo}
              started={Boolean(view.pendingResubscribeCheckoutUrl)}
            />
          ) : null}
          {view.hasPaidPlan ? (
            <>
              <Link
                href="/plans"
                className={`fh-button ${view.canUpgrade ? "fh-button--primary" : "fh-button--secondary"}`}
              >
                {view.canUpgrade ? "Upgrade to Yearly" : "Compare plans"}
              </Link>
              <BillingActions
                allowDowngrade={view.canDowngrade}
                allowCancel={view.canCancel}
                cancelScheduled={view.cancelAtPeriodEnd}
              />
            </>
          ) : (
            <Link href="/plans" className="fh-button fh-button--primary">
              Choose a plan
            </Link>
          )}
        </div>

        {view.hasPaidPlan && view.currentPeriodEnd && !view.cancelAtPeriodEnd ? (
          <p className="fh-plan-note">
            {view.pendingDowngradeTo
              ? "Your downgrade applies at the end of the current period."
              : "Your plan renews automatically. Cancel anytime and keep access until the end of the period you paid for."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
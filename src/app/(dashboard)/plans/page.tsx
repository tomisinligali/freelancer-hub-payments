import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { createSubscriptionService } from "@/lib/payments/subscription-service";
import { flutterwaveProvider } from "@/lib/payments/flutterwave/provider";
import { PLANS, getPlan } from "@/lib/payments/plans";
import { formatMoney } from "@/lib/payments/types";
import { SubscribeButton } from "@/components/payments/SubscribeButton";
import { UpgradeButton } from "@/components/payments/UpgradeButton";
import { DowngradeButton } from "@/components/payments/DowngradeButton";
import { CancelButton } from "@/components/payments/CancelButton";
import { ScheduleSubscribeButton } from "@/components/payments/ScheduleSubscribeButton";
import { ResubscribePayButton } from "@/components/payments/ResubscribePayButton";

export const metadata = {
  title: "Plans | Freelancer Hub",
};

export default async function PlansPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth?view=signin");
  }

  const params = await searchParams;
  const checkoutError =
    typeof params.error === "string" && params.error ? decodeURIComponent(params.error) : null;

  const service = createSubscriptionService(flutterwaveProvider);
  const view = await service.getView(session.user.id);

  return (
    <div className="fh-page">
      <div className="fh-page-heading">
        <h1 className="fh-auth-title">Choose a plan</h1>
        <p className="fh-dashboard-greeting">
          One plan, two intervals. You are currently on{" "}
          <strong>{getPlan(view.plan).name}</strong>.
        </p>
        {checkoutError ? (
          <p className="fh-message fh-message--error">{checkoutError}</p>
        ) : null}
        {view.pendingDowngradeTo ? (
          <p className="fh-message fh-message--info">
            Downgrade to {getPlan(view.pendingDowngradeTo).name} is scheduled and applies at the
            end of your current period.
          </p>
        ) : null}
        {view.pendingResubscribeTo ? (
          <div className="fh-message fh-message--info">
            <p>
              {getPlan(view.pendingResubscribeTo).name} is due to start when your current plan ends.
            </p>
            <ResubscribePayButton
              plan={view.pendingResubscribeTo}
              started={Boolean(view.pendingResubscribeCheckoutUrl)}
            />
          </div>
        ) : null}
      </div>

      <div className="fh-plans-grid">
        {PLANS.map((plan) => {
          const isCurrent = plan.plan === view.plan;

          return (
            <section
              key={plan.id}
              className={`fh-plan-card fh-plan-card--${plan.plan.toLowerCase()}${isCurrent ? " fh-plan-card--current" : ""}`}
              aria-current={isCurrent ? "true" : undefined}
            >
              {isCurrent ? <span className="fh-plan-badge">Current plan</span> : null}
              <h2 className="fh-plan-name">{plan.name}</h2>
              <p className="fh-plan-price">
                {formatMoney(plan.price)}
                {plan.intervalLabel ? (
                  <span className="fh-plan-interval"> {plan.intervalLabel}</span>
                ) : null}
              </p>
              <p className="fh-plan-blurb">{plan.blurb}</p>

              <ul className="fh-plan-features">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>

              <div className="fh-plan-cta">
                {view.cancelAtPeriodEnd && plan.plan !== "FREE" ? (
                  <ScheduleSubscribeButton
                    plan={plan.plan}
                    currentPlan={view.plan}
                    periodEnd={view.currentPeriodEnd}
                    label={plan.plan === view.plan ? `Re-subscribe to ${plan.name} after it ends` : `Schedule ${plan.name} after your current plan`}
                  />
                ) : isCurrent ? null : view.canSubscribe ? (
                  <SubscribeButton plan={plan.plan} label={`Subscribe ${plan.name}`} />
                ) : plan.plan === "FREE" && view.canCancel && !view.cancelAtPeriodEnd ? (
                  <CancelButton />
                ) : view.canUpgrade && plan.plan === "YEARLY" ? (
                  <UpgradeButton proratedChargeKobo={view.proratedUpgradeCharge}>Upgrade plan</UpgradeButton>
                ) : view.canDowngrade && plan.plan === "MONTHLY" ? (
                  <DowngradeButton />
                ) : null}
              </div>

                          </section>
          );
        })}
      </div>
    </div>
  );
}
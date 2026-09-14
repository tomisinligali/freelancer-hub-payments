import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { createSubscriptionService } from "@/lib/payments/subscription-service";
import { flutterwaveProvider } from "@/lib/payments/flutterwave/provider";
import { getPlan } from "@/lib/payments/plans";

export const metadata = {
  title: "Payment | Freelancer Hub",
};

export default async function ReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ tx_ref?: string; status?: string; transaction_id?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth?view=signin");
  }

  const params = await searchParams;
  const txRefValue = typeof params.tx_ref === "string" ? params.tx_ref : "";
  const providerStatus = typeof params.status === "string" ? params.status : "";

  // The user abandoned the hosted checkout.
  if (providerStatus === "cancelled") {
    return (
      <ResultCard
        title="Checkout cancelled"
        body="You closed the payment page before completing checkout. No charge was made."
        ctaHref="/plans"
        ctaLabel="Back to plans"
      />
    );
  }

  if (!txRefValue) {
    return (
      <ResultCard
        title="Missing payment reference"
        body="We expected to receive a payment reference from the payment provider but did not get one."
        ctaHref="/billing"
        ctaLabel="Go to billing"
      />
    );
  }

  const service = createSubscriptionService(flutterwaveProvider);
  // Convert transaction id to string if present.
  const transactionIdRaw = Array.isArray(params.transaction_id)
    ? params.transaction_id[0]
    : params.transaction_id;
  const transactionId = transactionIdRaw ? String(transactionIdRaw) : undefined;

  const rawReturnParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    rawReturnParams[key] = Array.isArray(value) ? value[0] ?? value : value;
  }

  const result = await service.processReturn(session.user.id, txRefValue, transactionId, rawReturnParams);

  if (result.status === "COMPLETED") {
    return (
      <ResultCard
        title="Payment successful"
        body={result.message}
        badgeLabel={`You are now on the ${getPlan(result.plan).name} plan.`}
        ctaHref="/billing"
        ctaLabel="View billing"
      />
    );
  }

  if (result.status === "PENDING") {
    return (
      <ResultCard
        title="Activation in progress"
        body={result.message}
        ctaHref="/billing"
        ctaLabel="Go to billing"
      />
    );
  }

  return (
    <ResultCard
      title="Payment not completed"
      body={result.message}
      ctaHref="/billing"
      ctaLabel="Go to billing"
    />
  );
}

function ResultCard({
  title,
  body,
  badgeLabel,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  body: string;
  badgeLabel?: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <div className="fh-dashboard-content fh-dashboard-content--centered">
      <div className="fh-dashboard-welcome-card">
        <div className="fh-auth-title-group">
          <h1 className="fh-auth-title">{title}</h1>
        </div>
        <p className="fh-dashboard-greeting">{body}</p>
        {badgeLabel ? (
          <p className="fh-message fh-message--success">
            <span>{badgeLabel}</span>
          </p>
        ) : null}
        <div className="fh-dashboard-actions">
          <Link href={ctaHref} className="fh-button fh-button--primary">
            {ctaLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
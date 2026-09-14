import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { SignOutButton } from "@/components/dashboard/SignOutButton";
import { getPlan } from "@/lib/payments/plans";
import { createSubscriptionService } from "@/lib/payments/subscription-service";
import { flutterwaveProvider } from "@/lib/payments/flutterwave/provider";

export const metadata = {
  title: "Dashboard | Freelancer Hub",
};

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/auth?view=signin");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      fullName: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  });

  // The effective plan comes from the subscription service so a verified
  // payment (or a due scheduled change) is always reflected on the UI.
  const service = createSubscriptionService(flutterwaveProvider);
  const view = await service.getView(session.user.id);
  const plan = getPlan(view.plan);

  const name =
    user?.fullName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.email ||
    session.user.email ||
    "there";

  return (
    <div className="fh-dashboard-content">
      <section className="fh-dashboard-plan-banner">
        <div className="fh-dashboard-plan-banner-copy">
          <h2 className="fh-dashboard-plan-banner-title">
            You are on the {plan.name} plan
          </h2>
          <p className="fh-dashboard-plan-banner-body">{plan.blurb}</p>
        </div>
        <Link
          href="/plans"
          className="fh-button fh-button--primary fh-manage-plans-button"
        >
          {view.plan === "FREE" ? "Choose a plan" : "Manage plan"}
        </Link>
      </section>

      <div className="fh-dashboard-welcome-wrap">
        <div className="fh-dashboard-welcome-card">
          <div className="fh-auth-title-group">
            <h1 className="fh-auth-title">You Are Signed In</h1>
          </div>
          <p className="fh-dashboard-greeting">Welcome, {name}</p>
          <div className="fh-dashboard-actions">
            <SignOutButton />
          </div>
        </div>
      </div>
    </div>
  );
}
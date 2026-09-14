import React from "react";
import Link from "next/link";
import { auth } from "@/lib/auth/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { getPlan } from "@/lib/payments/plans";
import { createSubscriptionService } from "@/lib/payments/subscription-service";
import { flutterwaveProvider } from "@/lib/payments/flutterwave/provider";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth?view=signin");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, fullName: true, firstName: true, lastName: true },
  });

  // Same reconciled plan the dashboard uses, so a verified payment (or a due
  // scheduled change) is reflected here too.
  const service = createSubscriptionService(flutterwaveProvider);
  const view = await service.getView(session.user.id);
  const planLabel = getPlan(view.plan).name;

  const displayName =
    user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || session.user.email || "there";

  return (
    <div className="fh-dashboard-shell">
      <header className="fh-dashboard-header">
        <div className="fh-dashboard-header-inner">
          <Link href="/dashboard" className="fh-dashboard-logo">
            Freelancer Hub
          </Link>

          <nav className="fh-dashboard-nav" aria-label="Main navigation">
            <Link href="/plans" className="fh-dashboard-nav-link">
              Plans
            </Link>
            <Link href="/billing" className="fh-dashboard-nav-link">
              Billing
            </Link>
          </nav>

          <div className="fh-dashboard-user-info">
            <span className="fh-plan-badge">{planLabel}</span>
            <span className="fh-dashboard-user-email">{displayName}</span>
          </div>
        </div>
      </header>

      <main className="fh-dashboard-main">{children}</main>
    </div>
  );
}
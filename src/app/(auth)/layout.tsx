import React from "react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="fh-auth-container">
      <div className="fh-auth-logo">
        <span className="fh-auth-logo-text">Freelancer Hub</span>
      </div>
      <div className="fh-auth-card">{children}</div>
    </main>
  );
}
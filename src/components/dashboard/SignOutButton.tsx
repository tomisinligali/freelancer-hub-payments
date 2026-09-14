"use client";

import React, { useTransition } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/Button";

export function SignOutButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="primary"
      onClick={() => startTransition(() => signOut({ callbackUrl: "/auth" }))}
      isLoading={isPending}
      className="fh-signout-button fh-btn-danger-outline"
    >
      Sign out
    </Button>
  );
}
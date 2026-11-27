"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "@/components/ui/button";

/** Marks getting started as done, then goes to `to` (or refreshes in place). */
export function FinishOnboarding({ label, to, ...props }: { label: string; to?: string } & ButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button {...props} disabled={busy} onClick={async () => {
      setBusy(true);
      await fetch("/api/onboarding/complete", { method: "POST" }).catch(() => undefined);
      if (to) router.push(to);
      router.refresh();
    }}>
      {busy ? "…" : label}
    </Button>
  );
}

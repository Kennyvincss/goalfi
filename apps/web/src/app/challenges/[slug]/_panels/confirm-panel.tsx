"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useAction } from "./use-action";

export function ConfirmPanel({ challengeId, hasMarket }: { challengeId: string; hasMarket: boolean }) {
  const [accepted, setAccepted] = useState(false);
  const { run, busy, error } = useAction();
  const router = useRouter();
  return (
    <div className="space-y-4 rounded-lg border-2 border-primary/40 bg-accent/40 p-5">
      <div>
        <h2 className="font-semibold">Review & confirm</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This is a draft only you can see. Check every detail on this page. Once confirmed, the rules, success criteria, dates and verification settings are frozen
          {hasMarket ? " and the on-chain pm-AMM market is created" : ""}.
        </p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        I confirm these rules are final and will be used to verify evidence and resolve the {hasMarket ? "market" : "challenge"}.
      </label>
      {error && <p className="text-sm text-no" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!accepted || busy} onClick={() => run(`/api/challenges/${challengeId}/confirm`, { json: { acceptRules: true } })}>
          {busy ? (hasMarket ? "Creating market on Solana…" : "Publishing…") : hasMarket ? "Confirm & create market" : "Confirm & publish"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={async () => { if (confirm("Delete this draft?") && (await run(`/api/challenges/${challengeId}`, { method: "DELETE" }))) router.push("/challenges"); }}>
          Delete draft
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { CircleCheck, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "./use-action";

export function ResolutionPanel({ challengeId, report, hasMarket, isPlatformAdmin, autoSettle = false }: {
  challengeId: string;
  autoSettle?: boolean;
  report: { ok: boolean; blockers: string[]; proposedOutcome: "YES" | "NO"; evaluation: { explanation: string } };
  hasMarket: boolean;
  isPlatformAdmin: boolean;
}) {
  const { run, busy, error } = useAction();
  const [confirmed, setConfirmed] = useState(false);
  const [override, setOverride] = useState("");
  const outcome = report.proposedOutcome;
  const flipped = outcome === "YES" ? "NO" : "YES";
  return (
    <div className="space-y-4 rounded-lg border p-5">
      <h2 className="font-semibold">Resolve challenge</h2>
      {autoSettle && <p className="text-sm text-muted-foreground">This challenge settles <b>automatically</b> as soon as nothing below is blocking it. You can also resolve it yourself once it’s unblocked.</p>}
      <div className="rounded-md bg-muted p-3 text-sm">
        <div>Computed from approved evidence: <b className={outcome === "YES" ? "text-yes" : "text-no"}>{outcome === "YES" ? "YES: goal achieved" : "NO: goal not achieved"}</b></div>
        <div className="text-muted-foreground">{report.evaluation.explanation}</div>
      </div>
      {report.blockers.length > 0 ? (
        <ul className="space-y-1.5 text-sm">
          {report.blockers.map((b) => <li key={b} className="flex gap-2 text-warning"><CircleAlert className="mt-0.5 size-4 shrink-0" />{b}</li>)}
        </ul>
      ) : (
        <>
          <p className="flex gap-2 text-sm text-yes"><CircleCheck className="mt-0.5 size-4 shrink-0" />All submissions reviewed, no open disputes, dispute window closed.</p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I reviewed the results and confirm the outcome {outcome}.{hasMarket ? " This resolves the on-chain market and cannot be undone." : ""}
          </label>
          <Button disabled={!confirmed || busy} onClick={() => run(`/api/challenges/${challengeId}/resolution`, { json: { outcome, confirm: true } })}>
            {busy ? (hasMarket ? "Resolving on Solana…" : "Resolving…") : `Resolve as ${outcome}`}
          </Button>
          {isPlatformAdmin && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Platform admin override</summary>
              <div className="mt-2 space-y-2">
                <input value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Reason for overriding (audited)" className="h-9 w-full rounded-md border bg-card px-3" />
                <Button size="sm" variant="outline" disabled={busy || override.trim().length < 10 || !confirmed} onClick={() => run(`/api/challenges/${challengeId}/resolution`, { json: { outcome: flipped, confirm: true, overrideReason: override } })}>Resolve as {flipped} instead</Button>
              </div>
            </details>
          )}
        </>
      )}
      {error && <p className="text-sm text-no" role="alert">{error}</p>}
    </div>
  );
}

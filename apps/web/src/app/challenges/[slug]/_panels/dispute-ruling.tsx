"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useAction } from "./use-action";

export function DisputeRuling({ disputeId, summary }: { disputeId: string; summary: string }) {
  const [note, setNote] = useState("");
  const { run, busy, error } = useAction();
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <p className="text-sm">{summary}</p>
      <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ruling note (recorded and shown to the participants)" className="min-h-16" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || note.trim().length < 3} onClick={() => run(`/api/disputes/${disputeId}/resolve`, { json: { ruling: "UPHELD", note } })}>Uphold (overturn decision)</Button>
        <Button size="sm" variant="outline" disabled={busy || note.trim().length < 3} onClick={() => run(`/api/disputes/${disputeId}/resolve`, { json: { ruling: "DISMISSED", note } })}>Dismiss (keep decision)</Button>
      </div>
      {error && <p className="text-xs text-no">{error}</p>}
    </div>
  );
}

"use client";

import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAction } from "./use-action";

export function StartNowPanel({ challengeId, startsAt }: { challengeId: string; startsAt: string }) {
  const { run, busy, error } = useAction();
  return (
    <Card>
      <CardContent className="space-y-3 pt-5 text-sm">
        <p>Scheduled to start <b>{new Date(startsAt).toLocaleString()}</b>.</p>
        <Button className="w-full" disabled={busy} onClick={() => run(`/api/challenges/${challengeId}/start`)}><Play />{busy ? "Starting…" : "Start now"}</Button>
        {error && <p className="text-no">{error}</p>}
      </CardContent>
    </Card>
  );
}

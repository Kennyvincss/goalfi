"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";

const NOTICES: Record<string, string> = {
  not_configured: "Fitness connections aren’t set up on this server yet (the admin needs to add the Google Health keys).",
  denied: "You cancelled the Google sign-in. Nothing was connected.",
  expired: "That sign-in link expired. Please try again.",
  failed: "Google didn’t accept the connection. Please try again.",
};

export function FitnessConnect({
  connected, status, lastSyncAt, lastError, available, notice, next,
}: {
  connected: boolean;
  status?: string;
  lastSyncAt?: string | null;
  lastError?: string | null;
  available: boolean;
  notice?: string;
  next?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectHref = `/api/fitness/google/connect${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  async function disconnect() {
    if (!confirm("Disconnect Google Health? Your stored step data is deleted, and you can’t join app-verified challenges until you reconnect. Steps already counted in challenges stay.")) return;
    setBusy(true);
    setError(null);
    const r = await fetch("/api/fitness/google/disconnect", { method: "POST" });
    setBusy(false);
    if (!r.ok) return setError((await r.json().catch(() => ({}))).error ?? "Could not disconnect");
    router.refresh();
  }
  return (
    <div className="space-y-3 text-sm">
      {notice && NOTICES[notice] && <p className="rounded-md bg-warning/10 px-3 py-2 text-warning" role="status">{NOTICES[notice]}</p>}
      {connected ? (
        <>
          <p>
            <b>Google Health</b> (Fitbit, Pixel Watch):{" "}
            {status === "ACTIVE" ? <span className="text-yes">connected</span> : <span className="text-no">needs reconnecting</span>}
            {lastSyncAt && <span className="text-muted-foreground"> · last synced {new Date(lastSyncAt).toLocaleString()}</span>}
          </p>
          {status !== "ACTIVE" && lastError && <p className="text-xs text-muted-foreground">{lastError}</p>}
          <div className="flex flex-wrap gap-2">
            {status !== "ACTIVE" && <Button asChild><a href={connectHref}>Reconnect</a></Button>}
            <Button variant="outline" onClick={disconnect} disabled={busy}>{busy ? "Disconnecting…" : "Disconnect"}</Button>
          </div>
        </>
      ) : (
        <>
          <Button asChild={available} disabled={!available}>
            {available ? <a href={connectHref}><Activity />Connect Google Health</a> : <span><Activity />Connect Google Health</span>}
          </Button>
          <p className="text-xs text-muted-foreground">
            Works with Fitbit and Pixel Watch. GoalFi asks for <b>read-only</b> access to activity data and uses only your <b>daily step count</b>.
            In app-verified challenges you join, your daily step totals are shown to the other participants as evidence. You can disconnect at any time.
          </p>
        </>
      )}
      {error && <p className="text-no">{error}</p>}
    </div>
  );
}

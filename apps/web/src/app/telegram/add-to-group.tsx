"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TelegramActions({ hasTelegram, communities }: { hasTelegram: boolean; communities: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [startedBot, setStartedBot] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  async function go(purpose: "LINK_GROUP" | "LINK_ACCOUNT") {
    setBusy(purpose);
    setError(null);
    const r = await fetch("/api/telegram/link-code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose, ...(purpose === "LINK_GROUP" && target ? { communityId: target } : {}) }) });
    const d = await r.json();
    setBusy(null);
    if (!r.ok) return setError(d.error ?? "Could not create link");
    window.open(d.url, "_blank", "noopener,noreferrer");
    if (purpose === "LINK_ACCOUNT") setStartedBot(true);
  }
  return (
    <div className="space-y-3">
      {!hasTelegram ? (
        <div className="space-y-2">
          <Button onClick={() => go("LINK_ACCOUNT")} disabled={!!busy}><UserRoundCheck />{busy === "LINK_ACCOUNT" ? "Opening…" : "1. Connect your Telegram account"}</Button>
          <p className="text-xs text-muted-foreground">Opens the bot in Telegram. Tap <b>Start</b>; the bot replies “Linked to GoalFi account…”. Then come back here.</p>
          {startedBot && <Button variant="outline" size="sm" onClick={() => router.refresh()}>Done: refresh this page</Button>}
          <Button disabled variant="outline"><Send />2. Add GoalFi to a group</Button>
          <p className="text-xs text-muted-foreground">Step 2 unlocks after step 1, because the bot has to know it’s you adding it.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-yes">✓ Your Telegram account is connected.</p>
          {communities.length > 0 && (
            <div className="space-y-1">
              <label htmlFor="target" className="text-sm font-medium">Connect the group to</label>
              <select id="target" value={target} onChange={(e) => setTarget(e.target.value)} className="h-10 w-full max-w-sm rounded-md border bg-card px-3 text-sm">
                <option value="">A new community named after the group</option>
                {communities.map((c) => <option key={c.id} value={c.id}>Existing community: {c.name}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">Pick an existing community to have its challenges announced in the group.</p>
            </div>
          )}
          <Button onClick={() => go("LINK_GROUP")} disabled={!!busy}><Send />{busy === "LINK_GROUP" ? "Opening…" : "Add GoalFi to a group"}</Button>
          <p className="text-xs text-muted-foreground">Pick a group where you’re an admin. Within a few seconds the bot posts “now connected” in the group, and current challenges are announced within a minute. If it posts a warning instead, it tells you what to fix.</p>
        </div>
      )}
      {error && <p className="text-sm text-no">{error}</p>}
      <p className="text-xs text-muted-foreground">Links are single-use and expire after 30 minutes.</p>
    </div>
  );
}

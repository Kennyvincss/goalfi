"use client";

import { useState } from "react";
import { Send, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TelegramActions({ hasTelegram }: { hasTelegram: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function go(purpose: "LINK_GROUP" | "LINK_ACCOUNT") {
    setBusy(purpose);
    setError(null);
    const r = await fetch("/api/telegram/link-code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose }) });
    const d = await r.json();
    setBusy(null);
    if (!r.ok) return setError(d.error ?? "Could not create link");
    window.open(d.url, "_blank", "noopener,noreferrer");
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {!hasTelegram && (
          <Button variant="outline" onClick={() => go("LINK_ACCOUNT")} disabled={!!busy}><UserRoundCheck />{busy === "LINK_ACCOUNT" ? "Opening…" : "1. Start the bot"}</Button>
        )}
        <Button onClick={() => go("LINK_GROUP")} disabled={!!busy}><Send />{busy === "LINK_GROUP" ? "Opening…" : hasTelegram ? "Add GoalFi to a group" : "2. Add GoalFi to a group"}</Button>
      </div>
      {error && <p className="text-sm text-no">{error}</p>}
      <p className="text-xs text-muted-foreground">Links are single-use and expire after 30 minutes.</p>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export const ACCOUNT_NOTICES: Record<string, string> = {
  not_configured: "That service isn’t set up on this server yet (the admin needs to add its keys).",
  denied: "You cancelled the sign-in. Nothing was connected.",
  expired: "That sign-in link expired. Please try again.",
  failed: "The service didn’t accept the connection. Please try again.",
  in_use: "That account is already connected to another GoalFi user.",
};

export interface AccountRow {
  slug: string;
  name: string;
  detail: string;
  privacy: string;
  available: boolean;
  account: { status: string; externalName: string | null; lastSyncAt: string | null; lastError: string | null; missing?: string | null } | null;
}

/** One provider: connect / reconnect / disconnect, with what GoalFi reads and shows. */
export function AccountConnect({ row, next }: { row: AccountRow; next?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const href = `/api/accounts/${row.slug}/connect${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  const a = row.account;
  async function disconnect() {
    if (!confirm(`Disconnect ${row.name}? Stored activity data is deleted, and you can’t join challenges verified by ${row.name} until you reconnect. Progress already counted in challenges stays.`)) return;
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/accounts/${row.slug}/disconnect`, { method: "POST" });
    setBusy(false);
    if (!r.ok) return setError((await r.json().catch(() => ({}))).error ?? "Could not disconnect");
    router.refresh();
  }
  return (
    <div className="space-y-2 border-b py-4 text-sm first:pt-0 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">{row.name}{a?.externalName && <span className="font-normal text-muted-foreground"> · {a.externalName}</span>}</div>
          <div className="text-xs text-muted-foreground">{row.detail}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {a ? (
            <>
              {(a.status !== "ACTIVE" || a.missing) && <Button asChild size="sm"><a href={href}>Reconnect</a></Button>}
              <Button size="sm" variant="outline" onClick={disconnect} disabled={busy}>{busy ? "Disconnecting…" : "Disconnect"}</Button>
            </>
          ) : row.available ? (
            <Button asChild size="sm"><a href={href}>Connect</a></Button>
          ) : (
            <Button size="sm" disabled>Not set up</Button>
          )}
        </div>
      </div>
      {a && (
        <p className="text-xs">
          {a.status === "ACTIVE" ? <span className="text-yes">Connected</span> : <span className="text-no">Needs reconnecting</span>}
          {a.lastSyncAt && <span className="text-muted-foreground"> · last synced {new Date(a.lastSyncAt).toLocaleString()}</span>}
          {a.status !== "ACTIVE" && a.lastError && <span className="block text-muted-foreground">{a.lastError}</span>}
          {a.status === "ACTIVE" && a.missing && <span className="block text-muted-foreground">{a.missing}</span>}
        </p>
      )}
      {!a && <p className="text-xs text-muted-foreground">{row.privacy}</p>}
      {error && <p className="text-no">{error}</p>}
    </div>
  );
}

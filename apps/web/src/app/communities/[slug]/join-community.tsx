"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function JoinCommunity({ communityId }: { communityId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div>
      <Button disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await fetch(`/api/communities/${communityId}/join`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
        setBusy(false);
        if (r.ok) router.refresh();
        else setError((await r.json().catch(() => ({}))).error ?? "Failed");
      }}>Join community</Button>
      {error && <p className="mt-1 text-sm text-no">{error}</p>}
    </div>
  );
}

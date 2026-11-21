"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";

export function CreateCommunity() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  if (!open) return <Button onClick={() => setOpen(true)}>Create community</Button>;
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const body = Object.fromEntries(new FormData(e.currentTarget));
    const r = await fetch("/api/communities", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(d.error ?? "Failed");
    router.push(`/communities/${d.slug}`);
  }
  return (
    <form onSubmit={onSubmit} className="w-full space-y-3 rounded-lg border bg-card p-4 sm:w-96">
      <div className="space-y-1.5"><Label htmlFor="cname">Name</Label><Input id="cname" name="name" required minLength={3} maxLength={60} /></div>
      <div className="space-y-1.5"><Label htmlFor="cdesc">Description</Label><Textarea id="cdesc" name="description" className="min-h-16" /></div>
      <div className="space-y-1.5"><Label htmlFor="cvis">Visibility</Label>
        <select id="cvis" name="visibility" className="h-10 w-full rounded-md border bg-card px-3 text-sm"><option value="PUBLIC">Public</option><option value="PRIVATE">Private (invite only)</option></select>
      </div>
      {error && <p className="text-sm text-no">{error}</p>}
      <div className="flex gap-2"><Button disabled={busy}>{busy ? "Creating…" : "Create"}</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}

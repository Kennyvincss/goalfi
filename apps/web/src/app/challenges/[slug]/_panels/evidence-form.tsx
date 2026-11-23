"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";

export function EvidenceForm({ challengeId, unit, needsDate, replaceable }: {
  challengeId: string;
  unit: string | null;
  needsDate: boolean;
  replaceable: { id: string; label: string }[];
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/challenges/${challengeId}/evidence`, { method: "POST", body: new FormData(e.currentTarget) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: data.error + (data.details ? `: ${Object.values(data.details).flat().join("; ")}` : "") });
    form.current?.reset();
    setMsg({ ok: true, text: `Submitted and locked (hash ${String(data.contentHash).slice(0, 12)}…). Verifiers have been notified.` });
    router.refresh();
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form ref={form} onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5"><Label htmlFor="ev-desc">What did you do?</Label><Textarea id="ev-desc" name="description" required minLength={3} className="min-h-20" /></div>
      <div className="grid gap-3 sm:grid-cols-2">
        {unit && <div className="space-y-1.5"><Label htmlFor="ev-prog">Progress ({unit})</Label><Input id="ev-prog" name="progressValue" type="number" step="any" min={0} required /></div>}
        {needsDate && <div className="space-y-1.5"><Label htmlFor="ev-date">Day</Label><Input id="ev-date" name="activityDate" type="date" max={today} defaultValue={today} required /></div>}
      </div>
      <div className="space-y-1.5"><Label htmlFor="ev-files">Files (images, video, PDF; up to 5 × 25 MB)</Label><Input id="ev-files" name="files" type="file" multiple accept="image/*,video/mp4,video/quicktime,video/webm,application/pdf,text/plain" className="py-1.5" /></div>
      <div className="space-y-1.5"><Label htmlFor="ev-links">Links (one per line)</Label><Textarea id="ev-links" name="links" className="min-h-14" placeholder="https://www.strava.com/activities/…" /></div>
      {replaceable.length > 0 && (
        <div className="space-y-1.5"><Label htmlFor="ev-sup">Replaces an earlier submission? <span className="text-muted-foreground">(optional)</span></Label>
          <select id="ev-sup" name="supersedesId" className="h-10 w-full rounded-md border bg-card px-3 text-sm"><option value="">No, this is new</option>{replaceable.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Submissions can’t be edited after sending. To correct one, submit a replacement; the original stays visible in history.</p>
      {msg && <p className={msg.ok ? "text-sm text-yes" : "text-sm text-no"} role="status">{msg.text}</p>}
      <Button disabled={busy}>{busy ? "Uploading…" : "Submit evidence"}</Button>
    </form>
  );
}

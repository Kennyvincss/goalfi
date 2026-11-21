"use client";

import { useState } from "react";
import { FileText, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useAction } from "./use-action";

export interface EvidenceItem {
  id: string;
  username: string;
  userId: string;
  description: string;
  links: string[];
  progressValue: string | null;
  activityDate: string | null;
  status: string;
  submittedAt: string;
  decidedAt: string | null;
  contentHash: string;
  superseded: boolean;
  files: { id: string; mimeType: string }[];
  votes: { username: string; decision: string; reason: string | null }[];
  disputes: { id: string; status: string; reason: string; finalDecision: string | null; resolutionNote: string | null }[];
}

const VARIANT: Record<string, "yes" | "no" | "warning" | "muted" | "outline"> = { APPROVED: "yes", REJECTED: "no", DISPUTED: "warning", UNDER_REVIEW: "outline", PENDING: "muted" };

export function EvidenceList({ items, viewerId, participantIds, disputeWindowHours, unit, mode }: {
  items: EvidenceItem[];
  viewerId: string | null;
  participantIds: string[];
  disputeWindowHours: number;
  unit: string | null;
  mode: "public" | "review";
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No submissions yet.</p>;
  return (
    <ul className="space-y-3">
      {items.map((e) => <EvidenceRow key={e.id} e={e} viewerId={viewerId} participantIds={participantIds} disputeWindowHours={disputeWindowHours} unit={unit} mode={mode} />)}
    </ul>
  );
}

function EvidenceRow({ e, viewerId, participantIds, disputeWindowHours, unit, mode }: {
  e: EvidenceItem; viewerId: string | null; participantIds: string[]; disputeWindowHours: number; unit: string | null; mode: "public" | "review";
}) {
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState("");
  const { run, busy, error } = useAction();
  const windowOpen = e.decidedAt && Date.now() < new Date(e.decidedAt).getTime() + disputeWindowHours * 3_600_000;
  const canDispute =
    viewerId && windowOpen && e.disputes.length === 0 && !e.superseded &&
    ((e.status === "REJECTED" && e.userId === viewerId) || (e.status === "APPROVED" && e.userId !== viewerId && participantIds.includes(viewerId)));
  const [rejectReason, setRejectReason] = useState("");
  return (
    <li className={`rounded-lg border p-4 ${e.superseded ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">@{e.username}{e.activityDate && <span className="text-muted-foreground"> · {e.activityDate}</span>}{e.progressValue && unit && <span className="text-muted-foreground"> · {Number(e.progressValue)} {unit}</span>}</span>
        <span className="flex items-center gap-2">
          {e.superseded && <Badge variant="muted">replaced</Badge>}
          <Badge variant={VARIANT[e.status] ?? "muted"}>{e.status.replace("_", " ").toLowerCase()}</Badge>
        </span>
      </div>
      <p className="mt-2 whitespace-pre-line text-sm">{e.description}</p>
      {(e.files.length > 0 || e.links.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {e.files.map((f, i) =>
            f.mimeType.startsWith("image/") ? (
              <a key={f.id} href={`/api/evidence/files/${f.id}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/evidence/files/${f.id}`} alt={`Evidence ${i + 1} from @${e.username}`} className="h-24 w-24 rounded-md border object-cover" />
              </a>
            ) : (
              <a key={f.id} href={`/api/evidence/files/${f.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"><FileText className="size-3.5" />{f.mimeType.split("/")[1]} file</a>
            ),
          )}
          {e.links.map((l) => (
            <a key={l} href={l} target="_blank" rel="noreferrer nofollow ugc" className="flex max-w-xs items-center gap-1 truncate rounded-md border px-2 py-1 text-xs hover:bg-muted"><Link2 className="size-3.5 shrink-0" />{new URL(l).host}</a>
          ))}
        </div>
      )}
      <div className="mt-2 text-xs text-muted-foreground">Submitted {new Date(e.submittedAt).toLocaleString()} · hash {e.contentHash.slice(0, 12)}…</div>
      {e.votes.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {e.votes.map((v) => <li key={v.username}><span className={v.decision === "APPROVE" ? "text-yes" : "text-no"}>{v.decision === "APPROVE" ? "✓" : "✗"}</span> @{v.username}{v.reason && <span className="text-muted-foreground">: {v.reason}</span>}</li>)}
        </ul>
      )}
      {e.disputes.map((d) => (
        <div key={d.id} className="mt-2 rounded-md bg-muted p-2 text-xs">
          <b>Dispute ({d.status.toLowerCase()}):</b> {d.reason}
          {d.resolutionNote && <div className="mt-1">Ruling: {d.resolutionNote}</div>}
        </div>
      ))}
      {mode === "review" && (e.status === "PENDING" || e.status === "UNDER_REVIEW") && !e.superseded && e.userId !== viewerId && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="yes" disabled={busy} onClick={() => run(`/api/evidence/${e.id}/review`, { json: { decision: "APPROVE" } })}>Approve</Button>
          <input value={rejectReason} onChange={(x) => setRejectReason(x.target.value)} placeholder="Reason to reject" className="h-8 min-w-40 flex-1 rounded-md border bg-card px-2 text-xs" aria-label="Rejection reason" />
          <Button size="sm" variant="no" disabled={busy || rejectReason.trim().length < 3} onClick={() => run(`/api/evidence/${e.id}/review`, { json: { decision: "REJECT", reason: rejectReason } })}>Reject</Button>
        </div>
      )}
      {canDispute && !disputing && <Button size="sm" variant="outline" className="mt-3" onClick={() => setDisputing(true)}>Dispute this decision</Button>}
      {disputing && (
        <div className="mt-3 space-y-2">
          <Textarea value={reason} onChange={(x) => setReason(x.target.value)} placeholder="Why is this decision wrong? (min. 10 characters)" className="min-h-16" />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || reason.trim().length < 10} onClick={async () => { if (await run(`/api/evidence/${e.id}/dispute`, { json: { reason } })) setDisputing(false); }}>Open dispute</Button>
            <Button size="sm" variant="ghost" onClick={() => setDisputing(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-no">{error}</p>}
    </li>
  );
}

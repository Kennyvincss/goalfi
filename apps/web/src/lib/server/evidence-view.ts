import "server-only";
import type { listEvidence } from "@goalfi/services";
import type { EvidenceItem } from "@/app/challenges/[slug]/_panels/evidence-list";

type Row = Awaited<ReturnType<typeof listEvidence>>[number];

/** Serialize evidence for client components (dates → ISO, decimals → string). */
export function toEvidenceItem(e: Row): EvidenceItem {
  return {
    id: e.id,
    userId: e.userId,
    username: e.user.username,
    description: e.description,
    links: e.links,
    progressValue: e.progressValue?.toString() ?? null,
    activityDate: e.activityDate?.toISOString().slice(0, 10) ?? null,
    status: e.status,
    submittedAt: e.submittedAt.toISOString(),
    decidedAt: e.decidedAt?.toISOString() ?? null,
    contentHash: e.contentHash,
    superseded: !!e.supersededBy,
    files: e.files.map((f) => ({ id: f.id, mimeType: f.mimeType })),
    votes: e.verifications.map((v) => ({ username: v.verifier.username, decision: v.decision, reason: v.reason })),
    disputes: e.disputes.map((d) => ({ id: d.id, status: d.status, reason: d.reason, finalDecision: d.finalDecision, resolutionNote: d.resolutionNote })),
  };
}

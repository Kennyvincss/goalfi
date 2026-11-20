import { createHash } from "node:crypto";
import { canSubmitEvidence, SuccessRuleSchema } from "@goalfi/core";
import { z } from "zod";
import { requireView } from "./authz";
import { link, type Actor, type ServiceContext } from "./context";
import { conflict, forbidden, invalid, notFound } from "./errors";
import { notify } from "./notifications";
import { ALLOWED_MIME, MAX_FILE_BYTES, MAX_FILES } from "./storage";

export const EvidenceInputSchema = z.object({
  description: z.string().trim().min(3).max(4000),
  links: z.array(z.url({ protocol: /^https?$/ }).max(2000)).max(10).default([]),
  progressValue: z.number().nonnegative().max(1e9).optional(),
  activityDate: z.iso.date().optional(),
  supersedesId: z.string().optional(),
});
export type EvidenceInput = z.input<typeof EvidenceInputSchema>;

export interface UploadedFile {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

/** Canonical manifest hash: binds description, links, progress, date and every file hash. */
export function evidenceContentHash(p: { description: string; links: string[]; progressValue?: number; activityDate?: string; fileHashes: string[] }): string {
  const manifest = JSON.stringify({
    d: p.description, l: p.links, p: p.progressValue ?? null, a: p.activityDate ?? null, f: [...p.fileHashes].sort(),
  });
  return createHash("sha256").update(manifest).digest("hex");
}

export async function submitEvidence(ctx: ServiceContext, actor: Actor, challengeId: string, raw: unknown, files: UploadedFile[]) {
  const parsed = EvidenceInputSchema.safeParse(raw);
  if (!parsed.success) throw invalid("Validation failed", z.flattenError(parsed.error).fieldErrors);
  const input = parsed.data;
  const a = await requireView(ctx.db, challengeId, actor);
  const c = a.challenge;
  const participant = await ctx.db.participant.findUnique({ where: { challengeId_userId: { challengeId, userId: actor.id } } });
  if (!participant || participant.status === "WITHDRAWN") throw forbidden("Join the challenge before submitting evidence");
  const now = ctx.now();
  if (!canSubmitEvidence(c.status, now, c.startDate, c.endDate)) throw conflict("Evidence can only be submitted while the challenge is running (plus a 24h grace period after it ends)");

  const rule = SuccessRuleSchema.parse(c.successRule);
  if ((rule.type === "individual_threshold" || rule.type === "collective_total") && input.progressValue === undefined)
    throw invalid(`Enter your progress in ${rule.unit}`);
  if (rule.type === "daily_completion" && !input.activityDate) throw invalid("Choose the day this evidence is for");
  if (input.activityDate) {
    const d = new Date(`${input.activityDate}T00:00:00Z`);
    const startDay = new Date(c.startDate.toISOString().slice(0, 10) + "T00:00:00Z");
    if (d < startDay || d > c.endDate || d > now) throw invalid("The activity date must be within the challenge period and not in the future");
  }
  if (files.length === 0 && input.links.length === 0) throw invalid("Attach at least one file or link");
  if (files.length > MAX_FILES) throw invalid(`At most ${MAX_FILES} files per submission`);
  for (const f of files) {
    if (!ALLOWED_MIME[f.mimeType]) throw invalid(`Unsupported file type: ${f.mimeType}`);
    if (f.bytes.byteLength === 0 || f.bytes.byteLength > MAX_FILE_BYTES) throw invalid(`Each file must be between 1 byte and ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  }
  if (input.supersedesId) {
    const old = await ctx.db.evidence.findUnique({ where: { id: input.supersedesId }, include: { supersededBy: true } });
    if (!old || old.userId !== actor.id || old.challengeId !== challengeId) throw invalid("You can only replace your own submission");
    if (old.supersededBy) throw conflict("That submission was already replaced");
    if (old.status !== "PENDING" && old.status !== "REJECTED") throw conflict("Only pending or rejected submissions can be replaced");
  }
  // Duplicate protection: a pending submission for the same day is enough.
  if (input.activityDate && !input.supersedesId) {
    const dup = await ctx.db.evidence.findFirst({
      where: { challengeId, userId: actor.id, activityDate: new Date(`${input.activityDate}T00:00:00Z`), status: { in: ["PENDING", "UNDER_REVIEW", "APPROVED"] }, supersededBy: null },
    });
    if (dup) throw conflict("You already have a submission for that day. Replace it instead.");
  }

  const stored = [];
  for (const f of files) stored.push({ ...(await ctx.storage.put(f.bytes, f.mimeType, challengeId)), mimeType: f.mimeType });
  const contentHash = evidenceContentHash({
    description: input.description, links: input.links, progressValue: input.progressValue, activityDate: input.activityDate, fileHashes: stored.map((s) => s.sha256),
  });

  const evidence = await ctx.db.evidence.create({
    data: {
      challengeId,
      participantId: participant.id,
      userId: actor.id,
      description: input.description,
      links: input.links,
      progressValue: input.progressValue,
      activityDate: input.activityDate ? new Date(`${input.activityDate}T00:00:00Z`) : null,
      contentHash,
      supersedesId: input.supersedesId ?? null,
      files: {
        create: stored.map((s) => ({ storageKey: s.key, fileUrl: s.key, mimeType: s.mimeType, sizeBytes: s.sizeBytes, sha256: s.sha256 })),
      },
    },
    include: { files: true },
  });
  await notify(ctx.db, a.verifierIds.filter((v) => v !== actor.id), {
    type: "EVIDENCE_RECEIVED",
    message: `New evidence from @${actor.username} in “${c.title}” needs review`,
    link: link(ctx, `/challenges/${c.slug}/review`),
    dedupKey: `EVIDENCE_RECEIVED:${evidence.id}`,
  });
  return evidence;
}

/** Evidence visible to a viewer: verifiers/admins see everything; others see approved + their own. */
export async function listEvidence(ctx: ServiceContext, actor: Actor | null, challengeId: string) {
  const a = await requireView(ctx.db, challengeId, actor);
  const full = a.isAdmin || a.isVerifier;
  return ctx.db.evidence.findMany({
    where: { challengeId, ...(full ? {} : { OR: [{ status: "APPROVED" }, ...(actor ? [{ userId: actor.id }] : [])] }) },
    orderBy: { submittedAt: "desc" },
    include: {
      user: { select: { username: true, displayName: true } },
      files: { select: { id: true, mimeType: true, sizeBytes: true, sha256: true } },
      verifications: { select: { verifierId: true, decision: true, reason: true, round: true, createdAt: true, verifier: { select: { username: true } } } },
      disputes: { select: { id: true, status: true, reason: true, userId: true, finalDecision: true, resolutionNote: true, createdAt: true } },
      supersededBy: { select: { id: true } },
    },
  });
}

/** Authorize access to one evidence file (same visibility as the evidence itself). */
export async function getEvidenceFile(ctx: ServiceContext, actor: Actor | null, fileId: string) {
  const f = await ctx.db.evidenceFile.findUnique({ where: { id: fileId }, include: { evidence: true } });
  if (!f) throw notFound("File not found");
  const a = await requireView(ctx.db, f.evidence.challengeId, actor);
  const allowed = a.isAdmin || a.isVerifier || f.evidence.status === "APPROVED" || f.evidence.userId === actor?.id;
  if (!allowed) throw notFound("File not found");
  const obj = await ctx.storage.get(f.fileUrl);
  if (!obj) throw notFound("File missing from storage");
  return { ...obj, mimeType: f.mimeType, sha256: f.sha256 };
}

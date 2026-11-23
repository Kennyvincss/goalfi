import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@goalfi/db";
import { SuccessRuleSchema, reviewDeadline } from "@goalfi/core";
import { challengeAccess, listEvidence } from "@goalfi/services";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/server/auth";
import { actorOf, services } from "@/lib/server/services";
import { toEvidenceItem } from "@/lib/server/evidence-view";
import { EvidenceList } from "../_panels/evidence-list";
import { DisputeRuling } from "../_panels/dispute-ruling";

export const metadata = { title: "Review evidence" };
export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/challenges/${slug}/review`);
  const row = await prisma.challenge.findUnique({ where: { slug }, select: { id: true } });
  if (!row) notFound();
  const actor = actorOf(user);
  const access = await challengeAccess(services().db, row.id, actor);
  if (!access.canView || (!access.isVerifier && !access.isAdmin)) notFound();
  const c = access.challenge;
  const rule = SuccessRuleSchema.parse(c.successRule);
  const all = (await listEvidence(services(), actor, c.id)).map(toEvidenceItem);
  const open = all.filter((e) => !e.superseded && (e.status === "PENDING" || e.status === "UNDER_REVIEW"));
  const mine = open.filter((e) => e.userId !== user.id && !e.votes.some((v) => v.username === user.username));
  const disputes = all.flatMap((e) => e.disputes.filter((d) => d.status === "OPEN").map((d) => ({ d, e })));
  const participants = await prisma.participant.findMany({ where: { challengeId: c.id }, select: { userId: true } });
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <div>
        <Link href={`/challenges/${slug}`} className="text-sm text-muted-foreground hover:text-foreground">← {c.title}</Link>
        <h1 className="mt-1 text-2xl font-bold">Review evidence</h1>
        <p className="text-sm text-muted-foreground">{c.requiredApprovals} approval(s) needed per submission. Evidence requirement: {c.evidenceReq}</p>
        {c.reviewDeadlineHours && (
          <p className="mt-1 text-sm font-medium text-warning">
            Review deadline: {reviewDeadline(c.endDate, c.reviewDeadlineHours)!.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. Anything not approved by then counts as rejected.
          </p>
        )}
      </div>
      {access.isAdmin && disputes.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Open disputes</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {disputes.map(({ d, e }) => (
              <DisputeRuling key={d.id} disputeId={d.id} summary={`@${e.username}'s submission (“${e.description.slice(0, 80)}”) disputed: ${d.reason}`} />
            ))}
          </CardContent>
        </Card>
      )}
      {access.isVerifier && (
        <Card>
          <CardHeader><CardTitle>Waiting for your review ({mine.length})</CardTitle></CardHeader>
          <CardContent>
            <EvidenceList items={mine} viewerId={user.id} participantIds={participants.map((p) => p.userId)} disputeWindowHours={c.disputeWindowHours} unit={"unit" in rule ? rule.unit : null} mode="review" />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>All submissions</CardTitle></CardHeader>
        <CardContent>
          <EvidenceList items={all} viewerId={user.id} participantIds={participants.map((p) => p.userId)} disputeWindowHours={c.disputeWindowHours} unit={"unit" in rule ? rule.unit : null} mode="public" />
        </CardContent>
      </Card>
    </div>
  );
}

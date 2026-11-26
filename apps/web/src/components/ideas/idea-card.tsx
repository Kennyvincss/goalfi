import Link from "next/link";
import { APP_METRICS, metricSourceLabel, type AppSuggestion, type ChallengeTemplate } from "@goalfi/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const DIFF: Record<string, { label: string; cls: string }> = {
  easy: { label: "Easy", cls: "border-yes/40 text-yes" },
  medium: { label: "Medium", cls: "border-warning/50 text-warning" },
  hard: { label: "Hard", cls: "border-no/40 text-no" },
};
const length = (d: number) => (d === 1 ? "Today" : `${d} days`);

function DifficultyBadge({ d }: { d?: string }) {
  if (!d || !DIFF[d]) return null;
  return <Badge variant="outline" className={cn(DIFF[d]!.cls)}>{DIFF[d]!.label}</Badge>;
}

/** A challenge suggested from connected data (or for a community). Verifies itself. */
export function SuggestionCard({ s, communityId }: { s: AppSuggestion; communityId?: string }) {
  const m = APP_METRICS[s.metric];
  const q = new URLSearchParams({ suggest: s.id, ...(communityId ? { community: communityId } : {}) });
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="muted">{length(s.durationDays)}</Badge>
          <DifficultyBadge d={s.difficulty} />
          <Badge variant="muted">Verified by {metricSourceLabel(m)}</Badge>
          {m.easyToGame && <Badge variant="outline" className="border-warning text-warning" title={m.easyToGame}>Easier to game</Badge>}
        </div>
        <CardTitle className="text-base">{s.title}</CardTitle>
        <CardDescription>{s.description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto space-y-3 text-sm">
        <p className="text-muted-foreground">Market: “{s.marketQuestion}” · suggested opening YES price {s.initialPriceBps / 100}%</p>
        <Button asChild size="sm"><Link href={`/challenges/new?${q}`}>Create this challenge</Link></Button>
      </CardContent>
    </Card>
  );
}

/** A task idea anyone can do; proof is reviewed by verifiers. */
export function TemplateCard({ t, category }: { t: ChallengeTemplate; category?: string }) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="muted">{length(t.durationDays)}</Badge>
          <DifficultyBadge d={t.difficulty} />
          {category && <Badge variant="muted">{category}</Badge>}
          <Badge variant="muted">Human-verified</Badge>
        </div>
        <CardTitle className="text-base">{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto space-y-3 text-sm">
        <p className="text-muted-foreground">Proof: {t.evidenceReq}</p>
        <Button asChild size="sm" variant="outline"><Link href={`/challenges/new?template=${encodeURIComponent(t.id)}`}>Create this challenge</Link></Button>
      </CardContent>
    </Card>
  );
}

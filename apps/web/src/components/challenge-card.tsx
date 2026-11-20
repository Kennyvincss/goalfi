import Link from "next/link";
import { Clock, Users } from "lucide-react";
import { formatProbability, formatUsd } from "@goalfi/core";
import type { ChallengeCardData } from "@/lib/server/queries";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CategoryIcon } from "./category-icon";
import { timeRemaining } from "@/lib/utils";

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "yes" | "muted" | "warning" | "outline" }> = {
  PENDING_MARKET: { label: "Launching", variant: "warning" },
  UPCOMING: { label: "Upcoming", variant: "outline" },
  ACTIVE: { label: "Live", variant: "yes" },
  IN_REVIEW: { label: "In review", variant: "warning" },
  RESOLVING: { label: "Resolving", variant: "warning" },
  RESOLVED: { label: "Resolved", variant: "muted" },
  SUSPENDED: { label: "Suspended", variant: "muted" },
  CANCELLED: { label: "Cancelled", variant: "muted" },
};

export function ProbabilityBar({ yes }: { yes: number }) {
  return (
    <div>
      <div className="flex justify-between text-sm font-semibold tabular">
        <span className="text-yes">YES {formatProbability(yes)}</span>
        <span className="text-no">NO {formatProbability(1 - yes)}</span>
      </div>
      <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-no-soft">
        <div className="bg-yes" style={{ width: `${yes * 100}%` }} />
      </div>
    </div>
  );
}

export function ChallengeCard({ c }: { c: ChallengeCardData }) {
  const status = STATUS_LABEL[c.status] ?? { label: c.status, variant: "muted" as const };
  const snap = c.market?.snapshots[0];
  const hasPrice = snap && Number.isFinite(snap.yesPrice);
  return (
    <Link href={`/challenges/${c.slug}`} className="group">
      <Card className="flex h-full flex-col gap-4 p-5 transition-shadow group-hover:shadow-md">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CategoryIcon icon={c.category.icon} className="size-3.5" />
            {c.category.name}
            {c.community && <> · {c.community.name}</>}
          </span>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <h3 className="line-clamp-2 font-semibold leading-snug group-hover:text-primary">{c.title}</h3>
        {c.market && hasPrice ? (
          <ProbabilityBar yes={snap.yesPrice} />
        ) : (
          <p className="text-sm text-muted-foreground">{c.market ? "Market awaiting liquidity" : "No prediction market"}</p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular">
          <span className="flex items-center gap-1"><Users className="size-3.5" />{c._count.participants} joined</span>
          <span className="flex items-center gap-1"><Clock className="size-3.5" />{timeRemaining(c.endDate)}</span>
          {c.market && c.volumeMicro !== undefined && <span>Vol ${formatUsd(c.volumeMicro)}</span>}
        </div>
      </Card>
    </Link>
  );
}

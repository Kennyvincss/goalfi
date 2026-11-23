import Link from "next/link";
import { redirect } from "next/navigation";
import { APP_METRICS, formatMetricValue, PROVIDER_INFO, suggestChallenges, type AppMetricId, type AppSuggestion } from "@goalfi/core";
import { prisma } from "@goalfi/db";
import { listAccounts, recentDaily, syncAccount, telegramMemberCount, type AccountsConfig } from "@goalfi/services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountConnect } from "@/components/accounts/account-connect";
import { accountRows } from "@/lib/server/account-rows";
import { getCurrentUser } from "@/lib/server/auth";
import { accountsConfig } from "@/lib/server/accounts";
import { services } from "@/lib/server/services";
import { cn } from "@/lib/utils";

export const metadata = { title: "Connected apps" };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

function SuggestionCard({ s, communityId }: { s: AppSuggestion; communityId?: string }) {
  const m = APP_METRICS[s.metric];
  const q = new URLSearchParams({ suggest: s.id, ...(communityId ? { community: communityId } : {}) });
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="muted">{s.durationDays === 1 ? "Today" : `${s.durationDays} days`}</Badge>
          <Badge variant="muted">Verified by {PROVIDER_INFO[m.provider].name}</Badge>
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

async function syncIfDue(cfg: AccountsConfig | null, userId: string) {
  if (!cfg) return;
  const ctx = services();
  // Respects the 10-minute minimum interval, so reloading doesn't hammer the providers.
  for (const a of await listAccounts(ctx, userId))
    if (a.status === "ACTIVE") await syncAccount(ctx, cfg, userId, a.provider, isoDay(Date.now() - 14 * DAY), isoDay(Date.now() + DAY)).catch(() => 0);
}

export default async function ConnectedPage({ searchParams }: { searchParams: Promise<{ metric?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/connected");
  const ctx = services();
  const cfg = accountsConfig();
  await syncIfDue(cfg, user.id);
  const [rows, accounts] = await Promise.all([accountRows(user.id), listAccounts(ctx, user.id)]);
  const connected = new Set(accounts.filter((a) => a.status === "ACTIVE").map((a) => a.provider as string));
  const metrics = (Object.keys(APP_METRICS) as AppMetricId[]).filter((id) => connected.has(APP_METRICS[id].provider));
  const { metric: picked } = await searchParams;
  const metricId = metrics.includes(picked as AppMetricId) ? (picked as AppMetricId) : metrics[0];

  const communities = await prisma.community.findMany({
    where: { members: { some: { userId: user.id, role: { in: ["OWNER", "ADMIN"] } } } },
    select: { id: true, name: true, telegramChatId: true, _count: { select: { members: true } } },
  });

  const last7 = Array.from({ length: 7 }, (_, i) => isoDay(Date.now() - (6 - i) * DAY));
  const today = isoDay(Date.now());
  const history = metricId ? await recentDaily(ctx, user.id, metricId, 14) : [];
  const byDate = new Map(history.map((d) => [d.date, d.value]));
  // Today is still in progress, so suggestions use completed days only.
  const complete = history.filter((d) => d.date !== today).map((d) => d.value);
  const metric = metricId ? APP_METRICS[metricId] : null;
  const personal = metricId ? suggestChallenges(metricId, complete).filter((s) => s.scope === "personal") : [];

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Connected apps</h1>
        <p className="mt-1 text-muted-foreground">
          Challenges built on a connected account verify themselves: progress syncs automatically, nobody uploads screenshots, and the market settles on its own.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Your accounts</CardTitle></CardHeader>
        <CardContent>{rows.map((r) => <AccountConnect key={r.slug} row={r} next="/connected" />)}</CardContent>
      </Card>

      {metric && metricId && (
        <section className="space-y-4">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Metric">
            {metrics.map((id) => (
              <Link key={id} href={`/connected?metric=${id}`} role="tab" aria-selected={id === metricId}
                className={cn("rounded-full border px-3 py-1 text-sm", id === metricId ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
                {APP_METRICS[id].label}
              </Link>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{metric.label}: last 7 days</CardTitle>
              <CardDescription>{metric.description}. From {PROVIDER_INFO[metric.provider].name}; devices and apps upload in batches, so today can lag behind.</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="grid grid-cols-7 gap-1.5 text-center">
                {last7.map((d) => {
                  const v = byDate.get(d);
                  return (
                    <li key={d} className="rounded-md bg-muted px-0.5 py-2">
                      <div className="text-[11px] text-muted-foreground">{new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short" })}</div>
                      <div className="tabular text-sm font-medium">{v !== undefined ? formatMetricValue(metric, v) : "–"}</div>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
          <h2 className="text-xl font-semibold">Suggested for you</h2>
          <p className="text-sm text-muted-foreground">
            {complete.length > 0
              ? `Targets are based on your last ${complete.length} complete day${complete.length === 1 ? "" : "s"}. The opening price reflects how often you’ve hit each target.`
              : "No complete days synced yet, so these start from typical values and adapt once your data syncs."}
          </p>
          <div className="grid gap-4 md:grid-cols-3">{personal.map((s) => <SuggestionCard key={s.id} s={s} />)}</div>
        </section>
      )}

      {metrics.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Connect an account above to see your data and challenges suggested from it.</p>
      )}

      {await Promise.all(communities.map(async (c) => {
        const group = metricId ? suggestChallenges(metricId, complete, { name: c.name, memberCount: c._count.members }).filter((s) => s.scope === "group") : [];
        const level = suggestChallenges("community_members", [], { name: c.name, memberCount: c._count.members, currentLevel: c._count.members });
        const tgCount = c.telegramChatId && cfg?.telegram ? await telegramMemberCount(cfg.telegram.botToken, c.telegramChatId, fetch, cfg.telegram.apiRoot) : null;
        const tg = tgCount !== null ? suggestChallenges("telegram_members", [], { name: c.name, memberCount: c._count.members, currentLevel: tgCount }) : [];
        return (
          <section key={c.id} className="space-y-3">
            <h2 className="text-xl font-semibold">For {c.name}</h2>
            <p className="text-sm text-muted-foreground">
              {c._count.members} member{c._count.members === 1 ? "" : "s"} on GoalFi{tgCount !== null ? `, ${tgCount} in the Telegram group` : ""}. Growth challenges are counted by GoalFi and need no accounts; activity challenges need each participant to connect their own account.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {[...level.slice(0, 1), ...tg.slice(0, 1), ...group].map((s) => <SuggestionCard key={s.id} s={s} communityId={c.id} />)}
            </div>
          </section>
        );
      }))}
    </div>
  );
}

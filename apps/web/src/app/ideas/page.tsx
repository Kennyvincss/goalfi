import Link from "next/link";
import { APP_METRICS, CHALLENGE_TEMPLATES, metricSourceLabel, type AppSuggestion } from "@goalfi/core";
import { prisma } from "@goalfi/db";
import { SuggestionCard, TemplateCard } from "@/components/ideas/idea-card";
import { getCurrentUser } from "@/lib/server/auth";
import { accountsConfig, configuredSources } from "@/lib/server/accounts";
import { ACCOUNT_PROVIDERS, PROVIDER_INFO } from "@goalfi/core";
import { availableMetrics, communitySuggestions } from "@goalfi/services";
import { adminCommunities, personalIdeas } from "@/lib/server/ideas";
import { cn } from "@/lib/utils";

export const metadata = { title: "Challenge ideas" };
export const dynamic = "force-dynamic";

type Tab = "for-you" | "groups" | "anyone";
const DIFFS = ["all", "easy", "medium", "hard"] as const;

function Chips({ items, active, href }: { items: { key: string; label: string }[]; active: string; href: (k: string) => string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => (
        <Link key={i.key} href={href(i.key)} aria-current={i.key === active ? "true" : undefined}
          className={cn("rounded-full border px-3 py-1 text-sm", i.key === active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
          {i.label}
        </Link>
      ))}
    </div>
  );
}

export default async function Ideas({ searchParams }: { searchParams: Promise<{ tab?: string; difficulty?: string; category?: string }> }) {
  const user = await getCurrentUser();
  const q = await searchParams;
  const personal = user ? await personalIdeas(user.id) : [];
  const tab: Tab = q.tab === "groups" || q.tab === "anyone" || q.tab === "for-you" ? q.tab : personal.length ? "for-you" : "anyone";
  const difficulty = DIFFS.includes(q.difficulty as (typeof DIFFS)[number]) ? q.difficulty! : "all";
  const category = q.category ?? "all";
  const link = (over: Record<string, string>) => {
    const p = new URLSearchParams({ tab, difficulty, category, ...over });
    for (const [k, v] of [...p]) if (v === "all") p.delete(k);
    return `/ideas?${p}`;
  };
  const keep = (s: { difficulty?: string }) => difficulty === "all" || s.difficulty === difficulty;
  const categories = await prisma.category.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { slug: true, name: true } });
  const catName = new Map(categories.map((c) => [c.slug, c.name]));

  // Only name services that are set up on this site.
  const names = ACCOUNT_PROVIDERS.filter((p) => configuredSources().has(p)).map((p) => (p === "GOOGLE_HEALTH" ? "Google Health (Fitbit, Pixel Watch)" : PROVIDER_INFO[p].name));
  const connectable = names.length <= 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
  let body: React.ReactNode;
  if (tab === "for-you") {
    const groups = personal.map((g) => ({ ...g, ideas: g.ideas.filter(keep) })).filter((g) => g.ideas.length);
    body = !user ? (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"><Link className="text-primary" href="/login?next=/ideas">Sign in</Link> and connect an account to get ideas built from your own activity.</p>
    ) : personal.length === 0 ? (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Connect {connectable || "an account"} in <Link className="text-primary" href="/settings#accounts">Settings → Connected accounts</Link> and ideas built from your real activity appear here. Until then, browse <Link className="text-primary" href={link({ tab: "anyone" })}>ideas anyone can do</Link>.
      </p>
    ) : (
      groups.map((g) => (
        <section key={g.metric} className="space-y-3">
          <h2 className="text-lg font-semibold">{APP_METRICS[g.metric].label} <span className="text-sm font-normal text-muted-foreground">· {metricSourceLabel(APP_METRICS[g.metric], configuredSources())} · {g.days ? `based on your last ${g.days} days` : "starting targets until your data syncs"}</span></h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{g.ideas.map((s) => <SuggestionCard key={s.id} s={s} />)}</div>
        </section>
      ))
    );
  } else if (tab === "groups") {
    const communities = user ? await adminCommunities(user.id) : [];
    const metrics = availableMetrics(accountsConfig());
    body = !user || communities.length === 0 ? (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Group ideas appear for communities you run. <Link className="text-primary" href="/communities">Create or manage a community</Link>.
      </p>
    ) : (
      communities.map((c) => {
        const ideas = communitySuggestions(c, metrics).filter(keep);
        const byMetric = new Map<string, AppSuggestion[]>();
        for (const s of ideas) byMetric.set(s.metric, [...(byMetric.get(s.metric) ?? []), s]);
        return (
          <section key={c.id} className="space-y-4">
            <h2 className="text-xl font-semibold">For {c.name} <span className="text-sm font-normal text-muted-foreground">· {c.memberCount} member{c.memberCount === 1 ? "" : "s"}{c.telegramMembers !== null ? ` · ${c.telegramMembers} in Telegram` : ""}</span></h2>
            {[...byMetric].map(([metric, list]) => (
              <div key={metric} className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">{APP_METRICS[metric as keyof typeof APP_METRICS].label}</h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{list.map((s) => <SuggestionCard key={s.id} s={s} communityId={c.id} />)}</div>
              </div>
            ))}
          </section>
        );
      })
    );
  } else {
    const list = CHALLENGE_TEMPLATES.filter((t) => (category === "all" || t.category === category) && keep(t));
    body = (
      <>
        <Chips items={[{ key: "all", label: "All categories" }, ...categories.filter((c) => CHALLENGE_TEMPLATES.some((t) => t.category === c.slug)).map((c) => ({ key: c.slug, label: c.name }))]}
          active={category} href={(k) => link({ category: k })} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{list.map((t) => <TemplateCard key={t.id} t={t} category={catName.get(t.category)} />)}</div>
        {list.length === 0 && <p className="text-sm text-muted-foreground">No ideas match these filters.</p>}
      </>
    );
  }

  const personalCount = personal.reduce((n, g) => n + g.ideas.length, 0);
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Challenge ideas</h1>
        <p className="mt-1 text-muted-foreground">Pick one, tweak it, publish. Ideas from your own data verify and settle themselves; the rest are checked by verifiers.</p>
      </div>
      <Chips
        items={[
          { key: "for-you", label: `From your data${personalCount ? ` (${personalCount})` : ""}` },
          { key: "groups", label: "For your communities" },
          { key: "anyone", label: `Anyone can do (${CHALLENGE_TEMPLATES.length})` },
        ]}
        active={tab} href={(k) => link({ tab: k, category: "all" })} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Difficulty:</span>
        <Chips items={DIFFS.map((d) => ({ key: d, label: d === "all" ? "Any" : d[0]!.toUpperCase() + d.slice(1) }))} active={difficulty} href={(k) => link({ difficulty: k })} />
      </div>
      <div className="space-y-8">{body}</div>
    </div>
  );
}

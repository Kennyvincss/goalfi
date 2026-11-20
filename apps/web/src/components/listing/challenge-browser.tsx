import Link from "next/link";
import { Search } from "lucide-react";
import { ChallengeCard } from "@/components/challenge-card";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listCategories, listChallenges, type ChallengeSort } from "@/lib/server/queries";
import { cn } from "@/lib/utils";

const SORTS: { key: ChallengeSort; label: string }[] = [
  { key: "trending", label: "Trending" },
  { key: "new", label: "New" },
  { key: "ending", label: "Ending soon" },
  { key: "participants", label: "Most participants" },
  { key: "markets", label: "With markets" },
];
const MARKET_SORTS: { key: ChallengeSort; label: string }[] = [
  { key: "trending", label: "Trending" },
  { key: "new", label: "New" },
  { key: "ending", label: "Ending soon" },
  { key: "volume", label: "Most traded" },
  { key: "liquidity", label: "Highest liquidity" },
];

export type BrowserParams = { q?: string; category?: string; sort?: string };

export async function ChallengeBrowser({ basePath, params, viewerId, marketsOnly = false }: {
  basePath: string;
  params: BrowserParams;
  viewerId: string | null;
  marketsOnly?: boolean;
}) {
  const sorts = marketsOnly ? MARKET_SORTS : SORTS;
  const sort = (sorts.find((s) => s.key === params.sort)?.key ?? "trending") as ChallengeSort;
  const [items, categories] = await Promise.all([
    listChallenges({ viewerId, q: params.q?.slice(0, 100), category: params.category, sort, take: 48, onlyWithMarkets: marketsOnly }),
    listCategories(),
  ]);
  const href = (over: Partial<BrowserParams>) => {
    const p = new URLSearchParams();
    const merged = { ...params, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const chip = (active: boolean) =>
    cn("rounded-full border px-3 py-1.5 text-sm whitespace-nowrap", active ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground");

  return (
    <div className="space-y-5">
      <form action={basePath} className="flex gap-2" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" defaultValue={params.q} placeholder="Search challenges" className="pl-9" aria-label="Search challenges" />
        </div>
        {params.category && <input type="hidden" name="category" value={params.category} />}
        {params.sort && <input type="hidden" name="sort" value={params.sort} />}
        <Button type="submit" variant="outline">Search</Button>
      </form>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {sorts.map((s) => (
          <Link key={s.key} href={href({ sort: s.key })} className={chip(sort === s.key)}>{s.label}</Link>
        ))}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <Link href={href({ category: undefined })} className={chip(!params.category)}>All categories</Link>
        {categories.map((c) => (
          <Link key={c.slug} href={href({ category: c.slug })} className={chip(params.category === c.slug)}>{c.name}</Link>
        ))}
      </div>
      {items.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{items.map((c) => <ChallengeCard key={c.id} c={c} linkTo={marketsOnly ? "market" : "challenge"} />)}</div>
      ) : (
        <EmptyState title={params.q || params.category ? "Nothing matches these filters" : marketsOnly ? "No markets yet" : "No challenges yet"}>
          {marketsOnly ? "Markets appear when challenges launch with an on-chain pm-AMM market." : "Try another filter, or create a challenge."}
        </EmptyState>
      )}
    </div>
  );
}

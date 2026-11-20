import Link from "next/link";
import { ArrowRight, BarChart3, Bell, Coins, Flame, Lock, Scale, Send, ShieldCheck, Trophy, Users } from "lucide-react";
import { INITIAL_CATEGORIES } from "@goalfi/core";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChallengeCard } from "@/components/challenge-card";
import { CategoryIcon } from "@/components/category-icon";
import { HowItWorks } from "@/components/how-it-works";
import { EmptyState } from "@/components/empty-state";
import { getCurrentUser } from "@/lib/server/auth";
import { listCategories, listChallenges, platformStats } from "@/lib/server/queries";
import { compactNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FAQ = [
  { q: "Do I need a wallet or crypto to use GoalFi?", a: "No. You can create challenges, join them, submit evidence, verify, build streaks and earn reputation with just an account. A Solana wallet is only needed if you want to trade on a challenge's market." },
  { q: "What is the prediction market engine?", a: "Every market is a real on-chain market on the open-source Predict pm-AMM, an implementation of Paradigm's uniform AMM for outcome tokens on Solana. GoalFi does not run its own AMM, order book or simulated trading." },
  { q: "Who decides whether a challenge succeeded?", a: "Humans, by rules published before the challenge starts. Appointed verifiers approve evidence against a threshold (for example 2 of 3), participants can dispute decisions, and an admin confirms the computed result. GoalFi's backend blocks resolution while any submission is unreviewed or any dispute is open." },
  { q: "Can someone change their evidence after submitting?", a: "No. Submissions are content-hashed and locked at the database level. A correction is a new submission that references the original, so the history stays visible." },
  { q: "When does trading stop?", a: "At the challenge end date. The pm-AMM market expires on-chain at that moment, so nobody can trade on the verification results. Review and disputes happen afterwards, then the market resolves." },
  { q: "How do I get paid if I win?", a: "After resolution, each winning share redeems for 1 USDC (mUSDC on devnet), directly from the on-chain market to your own wallet. GoalFi never takes custody of your funds." },
  { q: "Is this real money?", a: "GoalFi currently runs on Solana devnet with test tokens. Real-money trading stays disabled until the platform has passed security, legal and regulatory review." },
  { q: "Does trading earn reputation?", a: "No. Reputation comes only from meaningful participation: approved evidence, completed challenges, streaks, successful challenges you created and fair verification. Trading has its own separate leaderboard." },
];

export default async function Home() {
  const user = await getCurrentUser();
  const [stats, trending, markets, categories] = await Promise.all([
    platformStats(),
    listChallenges({ viewerId: user?.id ?? null, sort: "trending", take: 6 }),
    listChallenges({ viewerId: user?.id ?? null, sort: "markets", take: 3, onlyWithMarkets: true }),
    listCategories(),
  ]);
  const statItems = [
    { label: "Challenges", value: stats.challenges },
    { label: "Participants", value: stats.participants },
    { label: "Approved submissions", value: stats.approvedEvidence },
    { label: "Live markets", value: stats.activeMarkets },
  ].filter((s) => s.value > 0);
  const cats = categories.length > 0 ? categories : INITIAL_CATEGORIES.map((c) => ({ ...c, _count: { challenges: 0 } }));

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_60%_at_70%_0%,var(--accent),transparent)]" />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:py-24 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <Badge variant="outline" className="mb-5">Powered by Predict pm-AMM on Solana</Badge>
            <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-6xl">Turn Your Goals Into Markets.</h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground text-pretty">
              Set goals, challenge your community, prove your progress and predict the outcomes. Your commitments have never been this interesting.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg"><Link href="/discover">Explore Challenges <ArrowRight /></Link></Button>
              <Button asChild size="lg" variant="outline"><Link href="/challenges/new">Create a Challenge</Link></Button>
              <Button asChild size="lg" variant="ghost"><Link href="/telegram"><Send /> Add GoalFi to Telegram</Link></Button>
            </div>
            {statItems.length > 0 && (
              <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-4">
                {statItems.map((s) => (
                  <div key={s.label}>
                    <dt className="text-xs text-muted-foreground">{s.label}</dt>
                    <dd className="text-2xl font-semibold tabular">{compactNumber(s.value)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          {/* Illustration of a challenge, clearly labelled as an example, with no fake numbers. */}
          <Card className="relative p-6 shadow-xl">
            <Badge variant="muted" className="absolute right-4 top-4">Example</Badge>
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><CategoryIcon icon="dumbbell" className="size-3.5" />Fitness · Your community</div>
            <h2 className="mt-3 text-xl font-semibold">30-Day Running Challenge</h2>
            <p className="mt-2 text-sm text-muted-foreground">Can this community collectively complete 1,500 km of running within 30 days?</p>
            <ul className="mt-5 space-y-2.5 text-sm">
              <li className="flex gap-2"><Trophy className="mt-0.5 size-4 shrink-0 text-primary" />At least 15 participants each complete 100 km</li>
              <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />2 of 3 appointed verifiers approve each run</li>
              <li className="flex gap-2"><Scale className="mt-0.5 size-4 shrink-0 text-primary" />48h dispute window before resolution</li>
            </ul>
            <div className="mt-6 rounded-lg bg-muted p-4">
              <div className="text-sm font-medium">Will the community complete the challenge?</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-md bg-yes-soft py-2.5 text-center text-sm font-semibold text-yes">Buy YES</div>
                <div className="rounded-md bg-no-soft py-2.5 text-center text-sm font-semibold text-no">Buy NO</div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Prices are live probabilities from the on-chain pm-AMM market.</p>
            </div>
          </Card>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-4 py-16" id="how">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">How GoalFi works</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">One loop from commitment to settlement. Tap through each step.</p>
        <div className="mt-8"><HowItWorks /></div>
      </section>

      {/* Trending challenges */}
      <section className="mx-auto max-w-7xl px-4 py-10">
        <div className="flex items-end justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Trending challenges</h2>
          <Link href="/discover" className="text-sm font-medium text-primary">See all →</Link>
        </div>
        <div className="mt-6">
          {trending.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{trending.map((c) => <ChallengeCard key={c.id} c={c} />)}</div>
          ) : (
            <EmptyState title="No public challenges yet" action={<Button asChild><Link href="/challenges/new">Create the first one</Link></Button>}>
              Challenges appear here as soon as they’re published.
            </EmptyState>
          )}
        </div>
      </section>

      {/* Popular markets */}
      <section className="mx-auto max-w-7xl px-4 py-10">
        <div className="flex items-end justify-between">
          <h2 className="text-2xl font-bold tracking-tight">Popular prediction markets</h2>
          <Link href="/markets" className="text-sm font-medium text-primary">All markets →</Link>
        </div>
        <div className="mt-6">
          {markets.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{markets.map((c) => <ChallengeCard key={c.id} c={c} />)}</div>
          ) : (
            <EmptyState title="No live markets yet">Markets open when a challenge launches with an on-chain pm-AMM market and initial liquidity.</EmptyState>
          )}
        </div>
      </section>

      {/* Categories */}
      <section className="mx-auto max-w-7xl px-4 py-10">
        <h2 className="text-2xl font-bold tracking-tight">Challenge categories</h2>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {cats.map((c) => (
            <Link key={c.slug} href={`/discover?category=${c.slug}`} className="group rounded-lg border bg-card p-4 transition-colors hover:border-primary">
              <CategoryIcon icon={c.icon} className="size-6 text-primary" />
              <div className="mt-3 font-medium">{c.name}</div>
              {c._count.challenges > 0 && <div className="text-xs text-muted-foreground">{c._count.challenges} challenges</div>}
            </Link>
          ))}
        </div>
      </section>

      {/* Verification + trading */}
      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-16 lg:grid-cols-2">
        <Card className="p-7">
          <ShieldCheck className="size-7 text-primary" />
          <h2 className="mt-4 text-xl font-bold">How verification works</h2>
          <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
            <li><b className="text-foreground">Rules first.</b> Success criteria, evidence requirements and the approval threshold are fixed and confirmed before a challenge goes live.</li>
            <li><b className="text-foreground">Appointed verifiers.</b> Trusted members review each submission. Nobody can verify their own evidence or vote twice.</li>
            <li><b className="text-foreground">Locked evidence.</b> Files are hashed at upload. Edits are impossible; corrections become new, linked submissions.</li>
            <li><b className="text-foreground">Disputes.</b> Participants can challenge a decision within the dispute window. Admins rule, and every decision is logged.</li>
            <li><b className="text-foreground">Gated resolution.</b> Markets cannot resolve while any submission is unreviewed or any dispute is open.</li>
          </ul>
        </Card>
        <Card className="p-7">
          <BarChart3 className="size-7 text-primary" />
          <h2 className="mt-4 text-xl font-bold">How trading works</h2>
          <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
            <li><b className="text-foreground">Real on-chain markets.</b> Each challenge market is a Predict pm-AMM market on Solana with YES and NO outcome tokens.</li>
            <li><b className="text-foreground">Price = probability.</b> A YES price of 68% means the market thinks there’s a 68% chance the goal is met.</li>
            <li><b className="text-foreground">Quotes from the program.</b> Before you sign, GoalFi simulates your exact trade against the deployed program, including the 2% swap fee and slippage.</li>
            <li><b className="text-foreground">Liquidity decays by design.</b> pm-AMM liquidity shrinks toward the deadline, and trading closes at the end date.</li>
            <li><b className="text-foreground">Self-custody.</b> You sign every transaction. Winning shares redeem for 1 USDC each, straight to your wallet.</li>
          </ul>
        </Card>
      </section>

      {/* Community features */}
      <section className="mx-auto max-w-7xl px-4 py-10">
        <h2 className="text-2xl font-bold tracking-tight">Built for communities</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Send, t: "Telegram groups", d: "Add the GoalFi bot to your group for announcements, reminders and quick review actions." },
            { icon: Users, t: "Community pages", d: "Public or private communities with their own challenges, members and leaderboard." },
            { icon: Flame, t: "Streaks", d: "Daily, weekly and monthly streaks with reminders that keep people showing up." },
            { icon: Trophy, t: "Reputation", d: "Earned through approved evidence, completions and fair verification. Money can’t buy it." },
            { icon: Lock, t: "Private challenges", d: "Invite-only challenges for friends, teams and closed groups." },
            { icon: Bell, t: "Smart notifications", d: "Evidence reviews, disputes, resolutions and claimable winnings, without the spam." },
            { icon: Coins, t: "Community-funded markets", d: "Members can pool commitments to launch a market at crowd-set opening odds." },
            { icon: Scale, t: "Fair resolution", d: "Transparent rules, recorded decisions and on-chain settlement." },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="rounded-lg border bg-card p-5">
              <Icon className="size-5 text-primary" />
              <div className="mt-3 font-medium">{t}</div>
              <p className="mt-1 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-16" id="faq">
        <h2 className="text-2xl font-bold tracking-tight">Frequently asked questions</h2>
        <div className="mt-6 divide-y rounded-lg border bg-card">
          {FAQ.map((f) => (
            <details key={f.q} className="group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between font-medium">
                {f.q}
                <span className="text-muted-foreground transition-transform group-open:rotate-45" aria-hidden>+</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

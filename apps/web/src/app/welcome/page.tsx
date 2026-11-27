import Link from "next/link";
import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { CHALLENGE_TEMPLATES } from "@goalfi/core";
import { onboardingState } from "@goalfi/services";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AccountConnect } from "@/components/accounts/account-connect";
import { ChallengeCard } from "@/components/challenge-card";
import { SuggestionCard, TemplateCard } from "@/components/ideas/idea-card";
import { FinishOnboarding } from "@/components/onboarding/finish-button";
import { accountRows } from "@/lib/server/account-rows";
import { getCurrentUser } from "@/lib/server/auth";
import { topPicks } from "@/lib/server/ideas";
import { listChallenges } from "@/lib/server/queries";
import { services } from "@/lib/server/services";
import { cn } from "@/lib/utils";

export const metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

const STEPS = ["Connect a watch or app", "Pick a challenge", "Join one that’s running"] as const;

export default async function Welcome({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/welcome");
  const step = Math.min(3, Math.max(1, Number((await searchParams).step) || 1));
  const state = await onboardingState(services(), user.id);
  const doneFlags = [state.hasAccount, state.hasActivity, state.hasActivity];

  let body: React.ReactNode;
  if (step === 1) {
    const rows = await accountRows(user.id);
    body = (
      <>
        <p className="text-muted-foreground">
          Challenges built on a connected account verify and settle themselves: no screenshots, no waiting for verifiers. GoalFi only reads what it needs, read-only.
        </p>
        <Card><CardContent className="pt-6">{rows.map((r) => <AccountConnect key={r.slug} row={r} next="/welcome?step=2" />)}</CardContent></Card>
        <div className="flex flex-wrap gap-2">
          <Button asChild><Link href="/welcome?step=2">{state.hasAccount ? "Continue" : "Skip: I don’t have one"}</Link></Button>
        </div>
      </>
    );
  } else if (step === 2) {
    const picks = state.hasAccount ? await topPicks(user.id, 6) : [];
    const easy = CHALLENGE_TEMPLATES.filter((t) => t.difficulty === "easy").slice(0, 6);
    body = (
      <>
        <p className="text-muted-foreground">Start with something achievable. Every idea opens the form already filled in, and you can change anything before it goes live.</p>
        {picks.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">From your own data</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{picks.map((s) => <SuggestionCard key={s.id} s={s} />)}</div>
          </section>
        )}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Easy ideas anyone can do</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{easy.map((t) => <TemplateCard key={t.id} t={t} />)}</div>
        </section>
        <div className="flex flex-wrap gap-2">
          <Button asChild><Link href="/welcome?step=3">Continue</Link></Button>
          <Button asChild variant="outline"><Link href="/ideas">See all ideas</Link></Button>
        </div>
      </>
    );
  } else {
    const open = (await listChallenges({ viewerId: user.id, sort: "ending", take: 12 })).filter((c) => c.status === "ACTIVE" || c.status === "UPCOMING").slice(0, 6);
    body = (
      <>
        <p className="text-muted-foreground">Or jump into a challenge that’s already running. Joining is free and needs no wallet; a wallet is only for trading on the markets.</p>
        {open.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">{open.map((c) => <ChallengeCard key={c.id} c={c} />)}</div>
        ) : (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No open challenges right now. <Link className="text-primary" href="/ideas">Start one</Link> and invite friends.</p>
        )}
        <Card>
          <CardContent className="space-y-2 pt-6 text-sm">
            <p className="font-medium">Optional</p>
            <p>{state.telegram ? "✓ Telegram connected." : <><Link className="text-primary" href="/settings#telegram">Connect Telegram</Link> for reminders and group challenges.</>}</p>
            <p>{state.wallet ? "✓ Wallet linked." : <><Link className="text-primary" href="/settings#wallet">Link a Solana wallet</Link> when you want to trade on markets.</>}</p>
          </CardContent>
        </Card>
        <FinishOnboarding label="Finish" to="/dashboard" size="lg" />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Welcome to GoalFi, {user.displayName ?? user.username}</h1>
        <p className="mt-1 text-muted-foreground">Three quick steps. You can skip any of them.</p>
      </div>
      <ol className="flex flex-wrap gap-2" aria-label="Getting started">
        {STEPS.map((label, i) => (
          <li key={label}>
            <Link href={`/welcome?step=${i + 1}`} aria-current={step === i + 1 ? "step" : undefined}
              className={cn("flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm", step === i + 1 ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
              {doneFlags[i] ? <Check className="size-4" aria-label="done" /> : <span className="tabular text-xs opacity-70">{i + 1}</span>}{label}
            </Link>
          </li>
        ))}
      </ol>
      {body}
      {step < 3 && <p className="text-sm"><FinishOnboarding label="Skip getting started" to="/dashboard" variant="link" className="h-auto p-0" /></p>}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChallengeTemplate } from "@goalfi/core";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type RuleType = "individual_threshold" | "collective_total" | "daily_completion" | "milestone";

interface FormState {
  templateId: string | null;
  title: string;
  description: string;
  categorySlug: string;
  communityId: string;
  visibility: "PUBLIC" | "COMMUNITY" | "PRIVATE";
  kind: "PERSONAL" | "GROUP" | "COMPETITION";
  recurrence: "NONE" | "DAILY" | "WEEKLY" | "MONTHLY";
  rules: string;
  successCriteria: string;
  ruleType: RuleType;
  unit: string;
  threshold: number;
  target: number;
  requiredDays: number;
  minParticipants: number;
  evidenceReq: string;
  participationReq: string;
  startDate: string;
  endDate: string;
  verifiers: string;
  admins: string;
  requiredApprovals: number;
  disputeWindowHours: number;
  maxParticipants: string;
  hasReviewDeadline: boolean;
  reviewDeadlineHours: number;
  autoSettle: boolean;
  marketType: "BINARY" | "NONE";
  marketQuestion: string;
  initialPricePct: number;
  initialLiquidityUsdc: number;
}

const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function initialState(): FormState {
  const start = new Date(Date.now() + 3600_000);
  start.setMinutes(0, 0, 0);
  return {
    templateId: null, title: "", description: "", categorySlug: "fitness", communityId: "", visibility: "PUBLIC", kind: "GROUP", recurrence: "NONE",
    rules: "", successCriteria: "", ruleType: "individual_threshold", unit: "km", threshold: 50, target: 1000, requiredDays: 30, minParticipants: 1,
    evidenceReq: "", participationReq: "", startDate: toLocalInput(start), endDate: toLocalInput(new Date(start.getTime() + 7 * 86_400_000)),
    verifiers: "", admins: "", requiredApprovals: 1, disputeWindowHours: 24, maxParticipants: "",
    hasReviewDeadline: true, reviewDeadlineHours: 48, autoSettle: true,
    marketType: "BINARY", marketQuestion: "", initialPricePct: 50, initialLiquidityUsdc: 50,
  };
}

const STEPS = ["Template", "Basics", "Goal & evidence", "Schedule & verification", "Market", "Review"] as const;

/** Which builder step owns each field (server validation keys use the same names). */
const FIELD_STEP: Record<string, number> = {
  title: 1, description: 1, categorySlug: 1, communityId: 1, visibility: 1,
  rules: 2, successCriteria: 2, successRule: 2, unit: 2, amount: 2, evidenceReq: 2,
  startDate: 3, endDate: 3, verifierUsernames: 3, reviewDeadlineHours: 3, requiredApprovals: 3, disputeWindowHours: 3, maxParticipants: 3, adminUsernames: 3,
  marketQuestion: 4, market: 4, initialLiquidityUsdc: 4,
};
const FIELD_LABEL: Record<string, string> = {
  title: "Title", description: "Description", communityId: "Community", rules: "Rules", successCriteria: "Success criteria",
  successRule: "How success is measured", unit: "Unit", amount: "Amount", evidenceReq: "Evidence requirements", startDate: "Start",
  endDate: "End", reviewDeadlineHours: "Review deadline", verifierUsernames: "Verifiers", requiredApprovals: "Approvals required", disputeWindowHours: "Dispute window",
  marketQuestion: "Market question", market: "Market", initialLiquidityUsdc: "Initial liquidity",
};
const MAX_MARKET_DAYS = 30;

type Errors = Record<string, string>;

function validateStep(step: number, f: FormState, verifierCount: number): Errors {
  const e: Errors = {};
  const len = (s: string) => s.trim().length;
  if (step === 1) {
    if (len(f.title) < 4) e.title = "Give it a title of at least 4 characters.";
    if (len(f.description) < 10) e.description = "Describe the challenge in at least 10 characters.";
    if (f.visibility === "COMMUNITY" && !f.communityId) e.communityId = "Pick a community, or choose another visibility.";
  }
  if (step === 2) {
    if (len(f.rules) < 10) e.rules = "Write at least 10 characters: what counts and what doesn’t.";
    if (len(f.successCriteria) < 5) e.successCriteria = "Say what success means, in at least 5 characters.";
    if ((f.ruleType === "individual_threshold" || f.ruleType === "collective_total") && !len(f.unit)) e.unit = "Enter a unit, e.g. km or books.";
    const amount = f.ruleType === "individual_threshold" ? f.threshold : f.ruleType === "collective_total" ? f.target : f.ruleType === "daily_completion" ? f.requiredDays : f.minParticipants;
    if (!(amount > 0)) e.amount = "Enter a number above 0.";
    if (f.ruleType !== "collective_total" && !(f.minParticipants >= 1)) e.amount = "At least 1 participant must succeed.";
    if (len(f.evidenceReq) < 5) e.evidenceReq = "Say what proof people should upload (at least 5 characters).";
  }
  if (step === 3) {
    const start = new Date(f.startDate), end = new Date(f.endDate);
    if (Number.isNaN(start.getTime())) e.startDate = "Pick a start date and time.";
    if (Number.isNaN(end.getTime())) e.endDate = "Pick an end date and time.";
    else if (end <= start) e.endDate = "The end must be after the start.";
    else if (end.getTime() < Date.now() + 5 * 60_000) e.endDate = "The end must be at least 5 minutes from now.";
    if (verifierCount === 0) e.verifierUsernames = "Add at least one verifier: the GoalFi username of someone who will check evidence.";
    if (!(f.requiredApprovals >= 1)) e.requiredApprovals = "At least 1 approval is needed.";
    if (f.hasReviewDeadline && !(f.reviewDeadlineHours >= 24 && f.reviewDeadlineHours <= 336))
      e.reviewDeadlineHours = "Choose between 24 and 336 hours (14 days) after the end.";
    if (f.autoSettle && !f.hasReviewDeadline)
      e.reviewDeadlineHours = "Automatic settling needs a review deadline, so one missing review can’t block the result forever.";
    else if (verifierCount > 0 && f.requiredApprovals > verifierCount) e.requiredApprovals = `Can’t be more than your ${verifierCount} verifier${verifierCount === 1 ? "" : "s"}.`;
  }
  if (step === 4 && f.marketType === "BINARY") {
    if (len(f.marketQuestion || f.title) < 4) e.marketQuestion = "Write the question people will bet on (at least 4 characters).";
    if (!(f.initialLiquidityUsdc >= 1)) e.initialLiquidityUsdc = "Initial liquidity must be at least 1.";
    const end = new Date(f.endDate).getTime();
    if (end > Date.now() + MAX_MARKET_DAYS * 86_400_000) e.market = `With a market, the challenge must end within ${MAX_MARKET_DAYS} days (a Predict pm-AMM limit). Go Back to “Schedule & verification” to shorten it, or choose “No market”.`;
  }
  return e;
}

export function ChallengeBuilder({
  templates, categories, communities, collateralSymbol, marketsAvailable,
}: {
  templates: ChallengeTemplate[];
  categories: { slug: string; name: string }[];
  communities: { id: string; name: string }[];
  collateralSymbol: string;
  marketsAvailable: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [f, setF] = useState<FormState>(() => ({ ...initialState(), marketType: marketsAvailable ? "BINARY" : "NONE" }));
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, string[]>>({});
  const [stepErrors, setStepErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  function applyTemplate(t: ChallengeTemplate | null) {
    const base = initialState();
    if (!t) return setF({ ...base, marketType: marketsAvailable ? "BINARY" : "NONE" });
    const start = new Date(base.startDate);
    const r = t.successRule;
    setF({
      ...base,
      templateId: t.id, title: t.title, description: t.description, categorySlug: t.category, rules: t.rules,
      successCriteria: t.successCriteria, evidenceReq: t.evidenceReq, recurrence: t.recurrence, marketQuestion: t.marketQuestion,
      endDate: toLocalInput(new Date(start.getTime() + t.durationDays * 86_400_000)),
      ruleType: r.type,
      unit: "unit" in r ? r.unit : base.unit,
      threshold: r.type === "individual_threshold" ? r.threshold : base.threshold,
      target: r.type === "collective_total" ? r.target : base.target,
      requiredDays: r.type === "daily_completion" ? r.requiredDays : base.requiredDays,
      minParticipants: r.type === "milestone" ? r.minCompleters : "minParticipants" in r ? r.minParticipants : 1,
      marketType: marketsAvailable ? "BINARY" : "NONE",
    });
  }

  const successRule = useMemo(() => {
    switch (f.ruleType) {
      case "individual_threshold": return { type: f.ruleType, unit: f.unit, threshold: f.threshold, minParticipants: f.minParticipants };
      case "collective_total": return { type: f.ruleType, unit: f.unit, target: f.target };
      case "daily_completion": return { type: f.ruleType, requiredDays: f.requiredDays, minParticipants: f.minParticipants };
      case "milestone": return { type: f.ruleType, minCompleters: f.minParticipants };
    }
  }, [f]);

  const list = (s: string) => s.split(/[\s,]+/).map((x) => x.replace(/^@/, "").trim()).filter(Boolean);
  const payload = () => ({
    title: f.title, description: f.description, categorySlug: f.categorySlug, rules: f.rules, successCriteria: f.successCriteria,
    successRule, participationReq: f.participationReq || undefined, evidenceReq: f.evidenceReq, kind: f.kind, visibility: f.visibility,
    recurrence: f.recurrence, communityId: f.communityId || undefined, startDate: new Date(f.startDate).toISOString(), endDate: new Date(f.endDate).toISOString(),
    requiredApprovals: f.requiredApprovals, disputeWindowHours: f.disputeWindowHours, maxParticipants: f.maxParticipants ? Number(f.maxParticipants) : undefined,
    reviewDeadlineHours: f.hasReviewDeadline ? f.reviewDeadlineHours : undefined, autoSettle: f.autoSettle,
    verifierUsernames: list(f.verifiers), adminUsernames: list(f.admins), marketQuestion: f.marketQuestion || f.title,
    market: f.marketType === "NONE" ? { type: "NONE" } : { type: "BINARY", initialPriceBps: Math.round(f.initialPricePct * 100), initialLiquidityUsdc: f.initialLiquidityUsdc },
  });

  async function submit() {
    if (goToFirstProblem()) return;
    setBusy(true);
    setError(null);
    setDetails({});
    const res = await fetch("/api/challenges", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload()) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not create the challenge");
      setDetails(data.details ?? {});
      return;
    }
    router.push(`/challenges/${data.slug}`);
  }

  const verifierCount = list(f.verifiers).length;
  const field = (k: string) => {
    const msg = stepErrors[k] ?? details[k]?.[0];
    return msg ? <p className="text-xs text-no" role="alert">{msg}</p> : null;
  };
  const hint = (text: string) => <p className="text-xs text-muted-foreground">{text}</p>;

  /** Validate the current step before moving on; jump back to the first step with a problem on submit. */
  function next() {
    const errs = validateStep(step, f, verifierCount);
    setStepErrors(errs);
    if (Object.keys(errs).length) return;
    setStep(step + 1);
  }
  function goToFirstProblem(): boolean {
    for (let st = 1; st <= 4; st++) {
      const errs = validateStep(st, f, verifierCount);
      if (Object.keys(errs).length) {
        setStepErrors(errs);
        setStep(st);
        return true;
      }
    }
    return false;
  }
  const select = "h-10 w-full rounded-md border border-input bg-card px-3 text-sm";

  return (
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <ol className="flex gap-2 overflow-x-auto lg:flex-col" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              onClick={() => { if (i <= step) { setStepErrors({}); setStep(i); } }}
              className={cn("flex w-full items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm", i === step ? "bg-primary text-primary-foreground" : i < step ? "text-foreground hover:bg-muted" : "text-muted-foreground")}
              aria-current={i === step ? "step" : undefined}
            >
              <span className="tabular text-xs opacity-70">{i + 1}</span>{s}
            </button>
          </li>
        ))}
      </ol>

      <Card className="p-6">
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Start from a template</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <button onClick={() => { applyTemplate(null); setStep(1); }} className="rounded-lg border border-dashed p-4 text-left hover:border-primary">
                <div className="font-medium">Blank challenge</div>
                <div className="text-sm text-muted-foreground">Write everything yourself.</div>
              </button>
              {templates.map((t) => (
                <button key={t.id} onClick={() => { applyTemplate(t); setStep(1); }} className={cn("rounded-lg border p-4 text-left hover:border-primary", f.templateId === t.id && "border-primary")}>
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{t.title}</span><Badge variant="muted">{t.durationDays}d</Badge></div>
                  <div className="mt-1 text-sm text-muted-foreground">{t.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Basics</h2>
            <div className="space-y-1.5"><Label htmlFor="title">Title</Label><Input id="title" value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={120} placeholder="e.g. Run 50 km in 7 days" />{field("title") ?? hint("4–120 characters.")}</div>
            <div className="space-y-1.5"><Label htmlFor="desc">Description</Label><Textarea id="desc" value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="What is the goal, and who is it for?" />{field("description") ?? hint("At least 10 characters.")}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="cat">Category</Label>
                <select id="cat" className={select} value={f.categorySlug} onChange={(e) => set("categorySlug", e.target.value)}>{categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="kind">Type</Label>
                <select id="kind" className={select} value={f.kind} onChange={(e) => set("kind", e.target.value as FormState["kind"])}>
                  <option value="PERSONAL">Personal goal</option><option value="GROUP">Group challenge</option><option value="COMPETITION">Competition</option>
                </select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="comm">Community</Label>
                <select id="comm" className={select} value={f.communityId} onChange={(e) => set("communityId", e.target.value)}>
                  <option value="">None (independent)</option>{communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {communities.length === 0 && <p className="text-xs text-muted-foreground">You can post into communities you administer.</p>}
              </div>
              <div className="space-y-1.5"><Label htmlFor="vis">Visibility</Label>
                <select id="vis" className={select} value={f.visibility} onChange={(e) => set("visibility", e.target.value as FormState["visibility"])}>
                  <option value="PUBLIC">Public: anyone can discover</option>
                  <option value="COMMUNITY" disabled={!f.communityId}>Community members only</option>
                  <option value="PRIVATE">Private: invite only</option>
                </select>{field("communityId")}
              </div>
              <div className="space-y-1.5"><Label htmlFor="rec">Recurrence</Label>
                <select id="rec" className={select} value={f.recurrence} onChange={(e) => set("recurrence", e.target.value as FormState["recurrence"])}>
                  <option value="NONE">One-off</option><option value="DAILY">Daily habit (streaks)</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Goal & evidence</h2>
            <div className="space-y-1.5"><Label htmlFor="rules">Rules</Label><Textarea id="rules" value={f.rules} onChange={(e) => set("rules", e.target.value)} placeholder="e.g. Only outdoor or treadmill runs count. One run per submission." />{field("rules") ?? hint("At least 10 characters.")}</div>
            <div className="space-y-1.5"><Label htmlFor="crit">Success criteria (shown to everyone)</Label><Textarea id="crit" value={f.successCriteria} onChange={(e) => set("successCriteria", e.target.value)} className="min-h-16" placeholder="e.g. Each participant logs at least 50 km of approved runs." />{field("successCriteria") ?? hint("At least 5 characters. This is what “YES” means for the market.")}</div>
            <fieldset className="space-y-3 rounded-lg border p-4">
              <legend className="px-1 text-sm font-medium">How success is measured</legend>
              <select className={select} value={f.ruleType} onChange={(e) => set("ruleType", e.target.value as RuleType)} aria-label="Measurement type">
                <option value="individual_threshold">Each participant reaches an amount (e.g. 100 km)</option>
                <option value="collective_total">Group total reaches a target (e.g. 1,500 km)</option>
                <option value="daily_completion">Approved activity on N distinct days</option>
                <option value="milestone">Milestone reached (approved proof)</option>
              </select>
              <div className="grid gap-3 sm:grid-cols-3">
                {(f.ruleType === "individual_threshold" || f.ruleType === "collective_total") && (
                  <div className="space-y-1.5"><Label htmlFor="unit">Unit</Label><Input id="unit" value={f.unit} onChange={(e) => set("unit", e.target.value)} maxLength={32} />{field("unit")}</div>
                )}
                {f.ruleType === "individual_threshold" && <div className="space-y-1.5"><Label htmlFor="thr">Amount per person</Label><Input id="thr" type="number" min={0} value={f.threshold} onChange={(e) => set("threshold", Number(e.target.value))} /></div>}
                {f.ruleType === "collective_total" && <div className="space-y-1.5"><Label htmlFor="tgt">Group target</Label><Input id="tgt" type="number" min={0} value={f.target} onChange={(e) => set("target", Number(e.target.value))} /></div>}
                {f.ruleType === "daily_completion" && <div className="space-y-1.5"><Label htmlFor="days">Required days</Label><Input id="days" type="number" min={1} value={f.requiredDays} onChange={(e) => set("requiredDays", Number(e.target.value))} /></div>}
                {f.ruleType !== "collective_total" && (
                  <div className="space-y-1.5"><Label htmlFor="minp">{f.ruleType === "milestone" ? "Completers needed" : "Participants who must succeed"}</Label><Input id="minp" type="number" min={1} value={f.minParticipants} onChange={(e) => set("minParticipants", Number(e.target.value))} /></div>
                )}
              </div>
              {field("amount")}
              <p className="text-xs text-muted-foreground">The final outcome is computed from approved evidence using this rule.</p>
            </fieldset>
            <div className="space-y-1.5"><Label htmlFor="ev">Evidence requirements</Label><Textarea id="ev" value={f.evidenceReq} onChange={(e) => set("evidenceReq", e.target.value)} className="min-h-16" placeholder="e.g. Screenshot from Strava showing date and distance." />{field("evidenceReq") ?? hint("At least 5 characters.")}</div>
            <div className="space-y-1.5"><Label htmlFor="part">Participation requirements <span className="text-muted-foreground">(optional)</span></Label><Input id="part" value={f.participationReq} onChange={(e) => set("participationReq", e.target.value)} /></div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Schedule & verification</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="start">Start</Label><Input id="start" type="datetime-local" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />{field("startDate")}</div>
              <div className="space-y-1.5"><Label htmlFor="end">End (trading closes here)</Label><Input id="end" type="datetime-local" value={f.endDate} onChange={(e) => set("endDate", e.target.value)} />{field("endDate") ?? hint(f.marketType === "BINARY" ? `With a market: at most ${MAX_MARKET_DAYS} days from now.` : "")}</div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ver">Verifiers (GoalFi usernames)</Label>
              <Input id="ver" value={f.verifiers} onChange={(e) => set("verifiers", e.target.value)} placeholder="@alice @bob @carol" />
              <p className="text-xs text-muted-foreground">Trusted people who review evidence. They can’t review their own submissions.</p>{field("verifierUsernames")}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5"><Label htmlFor="appr">Approvals required</Label><Input id="appr" type="number" min={1} max={Math.max(1, verifierCount)} value={f.requiredApprovals} onChange={(e) => set("requiredApprovals", Number(e.target.value))} />
                <p className="text-xs text-muted-foreground">{f.requiredApprovals} of {verifierCount || "?"} verifiers</p>{field("requiredApprovals")}</div>
              <div className="space-y-1.5"><Label htmlFor="disp">Dispute window (hours)</Label><Input id="disp" type="number" min={1} max={336} value={f.disputeWindowHours} onChange={(e) => set("disputeWindowHours", Number(e.target.value))} /></div>
              <div className="space-y-1.5"><Label htmlFor="max">Max participants</Label><Input id="max" type="number" min={1} value={f.maxParticipants} onChange={(e) => set("maxParticipants", e.target.value)} placeholder="No limit" /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="adm">Extra administrators <span className="text-muted-foreground">(optional)</span></Label><Input id="adm" value={f.admins} onChange={(e) => set("admins", e.target.value)} placeholder="@dave" /></div>
            <fieldset className="space-y-3 rounded-lg border p-4">
              <legend className="px-1 text-sm font-medium">After the challenge ends</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={f.hasReviewDeadline} onChange={(e) => set("hasReviewDeadline", e.target.checked)} />
                <span>
                  <b>Review deadline:</b> verifiers have
                  <input aria-label="Review deadline in hours" type="number" min={24} max={336} value={f.reviewDeadlineHours} disabled={!f.hasReviewDeadline}
                    onChange={(e) => set("reviewDeadlineHours", Number(e.target.value))} className="mx-1.5 h-7 w-16 rounded border bg-card px-1.5 text-sm" />
                  hours after the end to decide.
                  <span className="block text-xs text-muted-foreground">Evidence not approved by then counts as <b>rejected</b> (the submitter can still dispute).</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={f.autoSettle} onChange={(e) => set("autoSettle", e.target.checked)} />
                <span>
                  <b>Settle automatically</b>
                  <span className="block text-xs text-muted-foreground">Once everything is reviewed, no disputes are open and the dispute window has passed, GoalFi settles the result computed from approved evidence, including the on-chain market, without an admin click.</span>
                </span>
              </label>
              {field("reviewDeadlineHours")}
            </fieldset>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Prediction market</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <button disabled={!marketsAvailable} onClick={() => set("marketType", "BINARY")} className={cn("rounded-lg border p-4 text-left disabled:opacity-50", f.marketType === "BINARY" && "border-primary ring-2 ring-primary/20")}>
                <div className="font-medium">YES / NO market</div>
                <div className="text-sm text-muted-foreground">A Predict pm-AMM market on Solana. Anyone can trade the outcome.</div>
                {!marketsAvailable && <div className="mt-1 text-xs text-warning">Market creation isn’t configured on this server.</div>}
              </button>
              <button onClick={() => set("marketType", "NONE")} className={cn("rounded-lg border p-4 text-left", f.marketType === "NONE" && "border-primary ring-2 ring-primary/20")}>
                <div className="font-medium">No market</div>
                <div className="text-sm text-muted-foreground">Just the challenge: participation, verification and reputation.</div>
              </button>
            </div>
            {field("market")}
            <p className="text-xs text-muted-foreground">Multi-outcome and community-funded (commitment vault) markets will be enabled after devnet verification.</p>
            {f.marketType === "BINARY" && (
              <div className="space-y-4">
                <div className="space-y-1.5"><Label htmlFor="q">Market question</Label><Input id="q" value={f.marketQuestion} onChange={(e) => set("marketQuestion", e.target.value)} placeholder={f.title ? `Will “${f.title}” succeed?` : "Will the community complete the challenge?"} />{field("marketQuestion") ?? hint("Leave empty to use the challenge title.")}</div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="px">Opening YES probability: {f.initialPricePct}%</Label>
                    <input id="px" type="range" min={1} max={99} value={f.initialPricePct} onChange={(e) => set("initialPricePct", Number(e.target.value))} className="w-full accent-[var(--primary)]" />
                  </div>
                  <div className="space-y-1.5"><Label htmlFor="liq">Initial liquidity ({collateralSymbol})</Label><Input id="liq" type="number" min={1} value={f.initialLiquidityUsdc} onChange={(e) => set("initialLiquidityUsdc", Number(e.target.value))} />{field("initialLiquidityUsdc")}
                    <p className="text-xs text-muted-foreground">You fund this from your own wallet after confirming. The market goes live once it’s funded.</p></div>
                </div>
                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  <li>Trading closes at the challenge end date; markets can run at most 30 days.</li>
                  <li>Swaps pay a 2% protocol fee. pm-AMM liquidity decays toward the deadline by design.</li>
                  <li>A YES/NO market can’t be cancelled. If the challenge is suspended, it resolves according to the rules above.</li>
                </ul>
              </div>
            )}
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Review</h2>
            <p className="text-sm text-muted-foreground">This creates a <b>draft</b>. On the next screen you’ll see the full summary and confirm the rules. Nothing goes live and no market is created before that.</p>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[180px_1fr]">
              <dt className="text-muted-foreground">Title</dt><dd>{f.title || "—"}</dd>
              <dt className="text-muted-foreground">When</dt><dd>{new Date(f.startDate).toLocaleString()} → {new Date(f.endDate).toLocaleString()}</dd>
              <dt className="text-muted-foreground">Success</dt><dd>{f.successCriteria || "—"}</dd>
              <dt className="text-muted-foreground">Verification</dt><dd>{f.requiredApprovals} of {verifierCount} verifiers · {f.disputeWindowHours}h disputes</dd>
              <dt className="text-muted-foreground">Settlement</dt><dd>{f.autoSettle ? "Automatic" : "Admin confirms"}{f.hasReviewDeadline ? ` · review deadline ${f.reviewDeadlineHours}h after the end (unreviewed = rejected)` : " · no review deadline"}</dd>
              <dt className="text-muted-foreground">Market</dt><dd>{f.marketType === "NONE" ? "None" : `YES/NO opening at ${f.initialPricePct}% with ${f.initialLiquidityUsdc} ${collateralSymbol}`}</dd>
            </dl>
            {error && (
              <div className="rounded-md bg-no-soft px-3 py-2 text-sm text-no" role="alert">
                {error}
                {Object.keys(details).length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {Object.entries(details).map(([k, v]) => (
                      <li key={k} className="flex flex-wrap items-center gap-2">
                        <span><b>{FIELD_LABEL[k] ?? k}:</b> {v[0]}</span>
                        {FIELD_STEP[k] !== undefined && (
                          <button type="button" className="rounded border border-no/40 px-2 py-0.5 text-xs" onClick={() => setStep(FIELD_STEP[k]!)}>Fix in “{STEPS[FIELD_STEP[k]!]}”</button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {step > 0 && (
          <div className="mt-8 flex justify-between">
            <Button variant="ghost" onClick={() => { setStepErrors({}); setStep(step - 1); }}>Back</Button>
            {step < STEPS.length - 1 ? <Button onClick={next}>Continue</Button> : <Button onClick={submit} disabled={busy}>{busy ? "Creating draft…" : "Create draft"}</Button>}
          </div>
        )}
      </Card>
    </div>
  );
}

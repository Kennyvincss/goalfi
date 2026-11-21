"use client";

import { useState } from "react";
import { BarChart3, CircleCheck, Coins, Flag, Scale, ShieldCheck, Upload, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "Create Goal", icon: Flag, title: "Create a goal", body: "Pick a template or write your own: measurable success criteria, dates, evidence rules and how many verifiers must approve." },
  { key: "Join Challenge", icon: Users, title: "Join the challenge", body: "Friends and community members join publicly on GoalFi or straight from your Telegram group. No wallet needed to participate." },
  { key: "Submit Evidence", icon: Upload, title: "Submit evidence", body: "Participants upload screenshots, videos, documents or links. Submissions are hashed and locked, so they can't be quietly edited later." },
  { key: "Verify", icon: ShieldCheck, title: "Human verification", body: "Appointed verifiers approve or reject each submission (e.g. 2 of 3 must approve). Every decision is recorded, and participants can dispute." },
  { key: "Trade", icon: BarChart3, title: "Trade the outcome", body: "Each challenge can have a Predict pm-AMM market on Solana. Buy YES or NO with USDC; prices show the crowd's probability." },
  { key: "Resolve", icon: Scale, title: "Resolve", body: "After the end date, once every submission is reviewed and disputes are settled, an admin confirms the result and the market resolves on-chain." },
  { key: "Claim", icon: Coins, title: "Claim", body: "Holders of the winning outcome redeem each share for 1 USDC directly from the on-chain market. GoalFi never holds your funds." },
];

export function HowItWorks() {
  const [i, setI] = useState(0);
  const step = STEPS[i]!;
  const Icon = step.icon;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <ol className="flex flex-wrap items-center gap-2" aria-label="GoalFi flow">
        {STEPS.map((s, idx) => (
          <li key={s.key} className="flex items-center gap-2">
            <button
              onClick={() => setI(idx)}
              onMouseEnter={() => setI(idx)}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                idx === i ? "border-primary bg-primary text-primary-foreground" : idx < i ? "border-primary/40 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
              aria-current={idx === i ? "step" : undefined}
            >
              {idx < i ? <CircleCheck className="size-4" /> : <span className="tabular text-xs opacity-70">{idx + 1}</span>}
              {s.key}
            </button>
            {idx < STEPS.length - 1 && <span className="text-muted-foreground" aria-hidden>→</span>}
          </li>
        ))}
      </ol>
      <div className="rounded-lg border bg-card p-6" aria-live="polite">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-accent text-accent-foreground"><Icon className="size-5" /></span>
          <div>
            <div className="text-xs font-medium text-muted-foreground">Step {i + 1} of {STEPS.length}</div>
            <div className="font-semibold">{step.title}</div>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
        <div className="mt-5 flex gap-2">
          <button className="text-sm font-medium text-muted-foreground disabled:opacity-40" disabled={i === 0} onClick={() => setI(i - 1)}>← Back</button>
          <button className="ml-auto text-sm font-medium text-primary disabled:opacity-40" disabled={i === STEPS.length - 1} onClick={() => setI(i + 1)}>Next →</button>
        </div>
      </div>
    </div>
  );
}

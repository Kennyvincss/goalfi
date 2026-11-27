"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { TelegramLoginButton } from "./telegram-login";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const nextParam = useSearchParams().get("next");
  const next = nextParam ?? "/dashboard";
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const body = Object.fromEntries(new FormData(e.currentTarget));
    const res = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      setFieldErrors(data.details ?? {});
      return;
    }
    // New accounts start with the getting-started steps (unless they were on their way somewhere).
    router.push(mode === "signup" && !nextParam ? "/welcome" : next.startsWith("/") ? next : "/dashboard");
    router.refresh();
  }

  const err = (k: string) => fieldErrors[k]?.[0] && <p className="text-xs text-no">{fieldErrors[k]![0]}</p>;

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {mode === "signup" ? (
          <>
            <div className="space-y-1.5"><Label htmlFor="username">Username</Label><Input id="username" name="username" autoComplete="username" required placeholder="e.g. runner_kim" />{err("username")}</div>
            <div className="space-y-1.5"><Label htmlFor="displayName">Display name <span className="text-muted-foreground">(optional)</span></Label><Input id="displayName" name="displayName" autoComplete="name" maxLength={50} />{err("displayName")}</div>
            <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" autoComplete="email" required />{err("email")}</div>
            <div className="space-y-1.5"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} />{err("password")}</div>
          </>
        ) : (
          <>
            <div className="space-y-1.5"><Label htmlFor="identifier">Username or email</Label><Input id="identifier" name="identifier" autoComplete="username" required /></div>
            <div className="space-y-1.5"><Label htmlFor="password">Password</Label><Input id="password" name="password" type="password" autoComplete="current-password" required /></div>
          </>
        )}
        {error && <p className="rounded-md bg-no-soft px-3 py-2 text-sm text-no" role="alert">{error}</p>}
        <Button className="w-full" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}</Button>
      </form>
      <div className="flex items-center gap-3 text-xs text-muted-foreground"><div className="h-px flex-1 bg-border" />or<div className="h-px flex-1 bg-border" /></div>
      <TelegramLoginButton onDone={() => { router.push(next); router.refresh(); }} />
      <p className="text-center text-sm text-muted-foreground">
        {mode === "signup" ? <>Already have an account? <Link className="text-primary" href="/login">Sign in</Link></> : <>New to GoalFi? <Link className="text-primary" href="/signup">Create an account</Link></>}
      </p>
      <p className="text-center text-xs text-muted-foreground">No wallet needed. Connect one later if you want to trade.</p>
    </div>
  );
}

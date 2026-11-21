"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LayoutDashboard, LogOut, Settings, ShieldCheck, Trophy, User } from "lucide-react";

export function UserMenu({ username, displayName, isAdmin }: { username: string; displayName: string | null; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }
  const initial = (displayName ?? username).slice(0, 1).toUpperCase();
  const item = "flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted";
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 rounded-full p-0.5 pr-2 hover:bg-muted" aria-haspopup="menu" aria-expanded={open}>
        <span className="grid size-8 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">{initial}</span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-56 rounded-lg border bg-card p-1.5 shadow-lg" onClick={() => setOpen(false)}>
          <div className="px-3 py-2 text-sm">
            <div className="font-medium">{displayName ?? username}</div>
            <div className="text-muted-foreground">@{username}</div>
          </div>
          <div className="my-1 border-t" />
          <Link href="/dashboard" className={item}><LayoutDashboard className="size-4" />Dashboard</Link>
          <Link href={`/profile/${username}`} className={item}><User className="size-4" />Profile</Link>
          <Link href="/leaderboard" className={item}><Trophy className="size-4" />Leaderboard</Link>
          <Link href="/settings" className={item}><Settings className="size-4" />Settings</Link>
          {isAdmin && <Link href="/admin" className={item}><ShieldCheck className="size-4" />Admin</Link>}
          <div className="my-1 border-t" />
          <button onClick={signOut} className={`${item} w-full text-left`}><LogOut className="size-4" />Sign out</button>
        </div>
      )}
    </div>
  );
}

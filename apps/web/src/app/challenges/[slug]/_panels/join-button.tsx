"use client";

import { Button } from "@/components/ui/button";
import { useAction } from "./use-action";

export function JoinButton({ challengeId, slug, joined, signedIn }: { challengeId: string; slug: string; joined: boolean; signedIn: boolean }) {
  const { run, busy, error } = useAction();
  if (!signedIn) return <Button asChild className="w-full"><a href={`/login?next=/challenges/${slug}`}>Sign in to join</a></Button>;
  return (
    <div className="space-y-2">
      {joined ? (
        <Button variant="outline" className="w-full" disabled={busy} onClick={() => confirm("Leave this challenge?") && run(`/api/challenges/${challengeId}/join`, { method: "DELETE" })}>Leave challenge</Button>
      ) : (
        <Button className="w-full" disabled={busy} onClick={() => run(`/api/challenges/${challengeId}/join`)}>{busy ? "Joining…" : "Join challenge"}</Button>
      )}
      {error && <p className="text-sm text-no">{error}</p>}
    </div>
  );
}

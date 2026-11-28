import Link from "next/link";
import { earnedBadges, successRate } from "@goalfi/core";
import { trackRecord } from "@goalfi/services";
import { services } from "@/lib/server/services";

/** "Created by @x · hosted 8, 6 settled · 75% success · no fair-play flags": a host's record next to their markets. */
export async function CreatorRecord({ userId, username }: { userId: string; username: string }) {
  const r = await trackRecord(services(), userId);
  const rate = successRate(r);
  const top = earnedBadges(r).at(-1);
  return (
    <p className="text-sm text-muted-foreground">
      Created by <Link className="hover:text-foreground" href={`/profile/${username}`}>@{username}</Link>
      {" · "}hosted {r.hosted}{r.hostedSettled ? `, ${r.hostedSettled} settled` : ""}
      {rate !== null && ` · ${Math.round(rate * 100)}% success as a participant`}
      {top && ` · ${top.emoji} ${top.label}`}
      {" · "}
      {r.selfBetFlags || r.hostTrades ? (
        <span className="text-no">
          {r.hostTrades ? `⚠ traded on own market ${r.hostTrades}×` : ""}
          {r.hostTrades && r.selfBetFlags ? " · " : ""}
          {r.selfBetFlags ? `⚠ bet against own challenge ${r.selfBetFlags}×` : ""}
        </span>
      ) : <span>no fair-play flags</span>}
    </p>
  );
}

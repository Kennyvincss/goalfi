import "server-only";
import { ACCOUNT_PROVIDERS, PROVIDER_INFO } from "@goalfi/core";
import { GOOGLE_SLEEP_SCOPE, listAccounts, providerSlug } from "@goalfi/services";
import type { AccountRow } from "@/components/accounts/account-connect";
import { accountsConfig } from "./accounts";
import { services } from "./services";

const PRIVACY: Record<string, string> = {
  GOOGLE_HEALTH: "Read-only. GoalFi reads daily steps, distance, running distance, floors, heart-zone minutes, workouts and wake-up time recorded by your Fitbit or Pixel Watch (anything typed in by hand is ignored). In app-verified challenges you join, those daily totals are shown to other participants as evidence.",
  WITHINGS: "Read-only. GoalFi reads daily steps and distance recorded by your Withings watch or tracker (phone-only data is ignored). In app-verified challenges you join, those daily totals are shown to other participants as evidence.",
  OURA: "Read-only. GoalFi reads daily steps, workouts and runs, and when your main sleep ended, as recorded by your ring (workouts logged by hand are ignored). In app-verified challenges you join, those daily values are shown to other participants as evidence.",
  GITHUB: "GoalFi asks for no extra permissions and reads only your public contribution calendar. Daily counts are shown to other participants in challenges you join.",
  LICHESS: "Read-only. GoalFi reads your finished games and puzzle results. Daily counts are shown to other participants in challenges you join. No Lichess app setup needed.",
};

/** Rows for the Connected accounts UI: every provider, configured or not, with the user's account. */
export async function accountRows(userId: string): Promise<AccountRow[]> {
  const cfg = accountsConfig();
  const accounts = await listAccounts(services(), userId);
  return ACCOUNT_PROVIDERS.map((p) => {
    const a = accounts.find((x) => x.provider === p);
    return {
      slug: providerSlug(p),
      name: PROVIDER_INFO[p].name,
      detail: PROVIDER_INFO[p].detail,
      privacy: PRIVACY[p] ?? "",
      available: !!cfg?.providers[p],
      account: a
        ? {
            status: a.status, externalName: a.externalName, lastSyncAt: a.lastSyncAt?.toISOString() ?? null, lastError: a.lastError,
            missing: p === "GOOGLE_HEALTH" && !a.scope.includes(GOOGLE_SLEEP_SCOPE) ? "Sleep access wasn’t granted, so wake-up challenges are unavailable. Reconnect and allow sleep to use them." : null,
          }
        : null,
    };
  });
}

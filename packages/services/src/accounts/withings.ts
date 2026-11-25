/**
 * Withings (checked against the withings-api client, which wraps the public API):
 * authorize at account.withings.com/oauth2_user/authorize2 (scope user.activity); tokens from
 * POST wbsapi.withings.net/v2/oauth2 with action=requesttoken; every response is wrapped as
 * { status, body } with status 0 = OK; daily activity from GET /v2/measure?action=getactivity
 * (startdateymd, enddateymd, data_fields, offset) → body.activities[] { date, steps, distance (m),
 * is_tracker }, paged with body.more / body.offset.
 */
import { readJson, ProviderError, type ConnectResult, type Fetch, type ProviderClient, type SyncedData, type TokenSet } from "./http";

const AUTH_URL = "https://account.withings.com/oauth2_user/authorize2";
const API = "https://wbsapi.withings.net";
export const WITHINGS_SCOPE = "user.activity";

export interface WithingsConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Withings returns HTTP 200 with a non-zero `status` on errors. Auth problems mean "reconnect". */
function unwrap(d: Record<string, unknown>, what: string): Record<string, unknown> {
  const status = Number(d.status ?? -1);
  if (status === 0) return (d.body ?? {}) as Record<string, unknown>;
  const reconnect = [100, 101, 102, 200, 401].includes(status);
  throw new ProviderError(`Withings ${what} failed (status ${status}${d.error ? `: ${String(d.error)}` : ""})`, reconnect ? 401 : 502, reconnect);
}

/** Steps and km per date from tracker-recorded activity (phone-only data is ignored). Several devices on one day: the larger value. */
export function parseWithingsActivities(activities: Record<string, unknown>[]): SyncedData["daily"] {
  const best = new Map<string, number>();
  const put = (metric: string, date: string, v: number) => {
    const k = `${metric}|${date}`;
    if (Number.isFinite(v) && v >= 0 && v > (best.get(k) ?? -1)) best.set(k, v);
  };
  for (const a of activities) {
    const date = typeof a.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : null;
    if (!date || a.is_tracker !== true) continue;
    if (a.steps !== undefined && a.steps !== null) put("steps", date, Number(a.steps));
    if (a.distance !== undefined && a.distance !== null) put("distance_km", date, Math.round((Number(a.distance) / 1000) * 100) / 100);
  }
  return [...best].map(([k, value]) => {
    const [metric, date] = k.split("|") as [string, string];
    return { metric, date, value };
  });
}

export function withingsProvider(cfg: WithingsConfig): ProviderClient {
  const token = async (f: Fetch, body: Record<string, string>): Promise<TokenSet & { userid: string | null }> => {
    const r = await f(`${API}/v2/oauth2`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ action: "requesttoken", client_id: cfg.clientId, client_secret: cfg.clientSecret, ...body }).toString(),
    });
    const b = unwrap(await readJson(r), "sign-in");
    return {
      accessToken: String(b.access_token), refreshToken: typeof b.refresh_token === "string" ? b.refresh_token : null,
      expiresAt: new Date(Date.now() + Number(b.expires_in ?? 10_800) * 1000), scope: String(b.scope ?? WITHINGS_SCOPE),
      userid: b.userid !== undefined && b.userid !== null ? String(b.userid) : null,
    };
  };
  return {
    id: "WITHINGS",
    authorize(state) {
      const u = new URL(AUTH_URL);
      u.search = new URLSearchParams({ response_type: "code", client_id: cfg.clientId, state, scope: WITHINGS_SCOPE, redirect_uri: cfg.redirectUri }).toString();
      return { url: u.toString() };
    },
    async exchange(code, _v, f): Promise<ConnectResult> {
      const t = await token(f, { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri });
      return { ...t, externalId: t.userid, externalName: null };
    },
    refresh: (refreshToken, f) => token(f, { grant_type: "refresh_token", refresh_token: refreshToken }),
    async revoke() {
      // Withings has no token-revocation call in its public API; access ends when the user removes GoalFi in their Withings account.
    },
    async fetch(accessToken, _account, startIso, endIso, f): Promise<SyncedData> {
      const activities: Record<string, unknown>[] = [];
      let offset: number | null = null;
      for (let page = 0; page < 10; page++) {
        const q = new URLSearchParams({ action: "getactivity", startdateymd: startIso, enddateymd: endIso, data_fields: "steps,distance", ...(offset !== null ? { offset: String(offset) } : {}) });
        const r = await f(`${API}/v2/measure?${q}`, { headers: { authorization: `Bearer ${accessToken}` } });
        if (r.status === 401) throw new ProviderError("Withings access expired", 401, true);
        const b = unwrap(await readJson(r), "activity");
        activities.push(...((Array.isArray(b.activities) ? b.activities : []) as Record<string, unknown>[]));
        if (!b.more) break;
        offset = Number(b.offset ?? 0);
      }
      return { daily: parseWithingsActivities(activities).filter((r) => r.date >= startIso && r.date < endIso), events: [] };
    },
  };
}

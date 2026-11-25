/**
 * Oura API v2 (checked against the oura-ring client, which tracks Oura's published OpenAPI spec):
 * authorize at cloud.ouraring.com/oauth/authorize, tokens from POST api.ouraring.com/oauth/token
 * (refresh tokens are single-use: the response carries a new one), revoke via GET /oauth/revoke.
 * Collections at api.ouraring.com/v2/usercollection/{type}?start_date&end_date, paged with
 * next_token, returning { data: [...], next_token }:
 *   daily_activity → { day, steps }
 *   workout        → { activity, day, distance (m), source ("manual" excluded), start_datetime, end_datetime }
 *   sleep          → { day, type ("long_sleep" = the main sleep), bedtime_end (local time with offset) }
 * No `scope` is sent, so Oura grants the scopes enabled on the app (personal, daily, workout).
 */
import { readJson, ProviderError, type ConnectResult, type Fetch, type ProviderClient, type SyncedData, type TokenSet } from "./http";

const AUTH_URL = "https://cloud.ouraring.com/oauth/authorize";
const API = "https://api.ouraring.com";
const MIN_WORKOUT_SECONDS = 10 * 60;

export interface OuraConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Turn Oura collections into per-day values for GoalFi's metrics. */
export function parseOura(p: { activity: Record<string, unknown>[]; workouts: Record<string, unknown>[]; sleep: Record<string, unknown>[] }): SyncedData["daily"] {
  const out: SyncedData["daily"] = [];
  for (const a of p.activity) if (isDay(a.day) && Number.isFinite(Number(a.steps))) out.push({ metric: "steps", date: a.day, value: Number(a.steps) });
  const workouts = new Map<string, number>(), runs = new Map<string, number>();
  for (const w of p.workouts) {
    if (!isDay(w.day) || w.source === "manual") continue; // logged by hand: not counted
    const secs = (Date.parse(String(w.end_datetime)) - Date.parse(String(w.start_datetime))) / 1000;
    if (secs >= MIN_WORKOUT_SECONDS) workouts.set(w.day, (workouts.get(w.day) ?? 0) + 1);
    const m = Number(w.distance);
    if (/run|jog/i.test(String(w.activity ?? "")) && !/walk|hik/i.test(String(w.activity ?? "")) && Number.isFinite(m) && m > 0)
      runs.set(w.day, Math.round(((runs.get(w.day) ?? 0) + m / 1000) * 100) / 100);
  }
  // Days the ring recorded activity but no workout or run are real zeros.
  const daysWithData = new Set(out.map((r) => r.date));
  for (const d of new Set([...daysWithData, ...workouts.keys()])) out.push({ metric: "workouts", date: d, value: workouts.get(d) ?? 0 });
  for (const d of new Set([...daysWithData, ...runs.keys()])) out.push({ metric: "running_km", date: d, value: runs.get(d) ?? 0 });
  // Wake-up time: local time at the end of the main sleep ("long_sleep"), dated by its local calendar day.
  const wakes = new Map<string, number>();
  for (const s of p.sleep) {
    if (s.type !== "long_sleep" || typeof s.bedtime_end !== "string") continue;
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(s.bedtime_end);
    if (!m) continue;
    const mins = Number(m[2]) * 60 + Number(m[3]);
    if (!wakes.has(m[1]!) || mins > wakes.get(m[1]!)!) wakes.set(m[1]!, mins);
  }
  for (const [d, v] of wakes) out.push({ metric: "wake_time", date: d, value: v });
  return out;
}

export function ouraProvider(cfg: OuraConfig): ProviderClient {
  const token = async (f: Fetch, body: Record<string, string>): Promise<TokenSet> => {
    const r = await f(`${API}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...body }).toString(),
    });
    const d = await readJson(r);
    if (!r.ok || typeof d.access_token !== "string")
      throw new ProviderError(`Oura sign-in failed: ${String(d.error_description ?? d.error ?? r.status)}`, r.status, d.error === "invalid_grant");
    return {
      accessToken: d.access_token, refreshToken: typeof d.refresh_token === "string" ? d.refresh_token : null,
      expiresAt: new Date(Date.now() + Number(d.expires_in ?? 86_400) * 1000), scope: String(d.scope ?? "daily workout personal"),
    };
  };
  const collection = async (f: Fetch, accessToken: string, type: string, start: string, end: string) => {
    const rows: Record<string, unknown>[] = [];
    let next: string | null = null;
    for (let page = 0; page < 20; page++) {
      const q = new URLSearchParams(next ? { next_token: next } : { start_date: start, end_date: end });
      const r = await f(`${API}/v2/usercollection/${type}?${q}`, { headers: { authorization: `Bearer ${accessToken}` } });
      const d = await readJson(r);
      if (!r.ok) throw new ProviderError(`Oura ${type} ${r.status}: ${String(d.detail ?? d.message ?? "")}`.slice(0, 300), r.status, r.status === 401 || r.status === 403);
      rows.push(...((Array.isArray(d.data) ? d.data : []) as Record<string, unknown>[]));
      next = typeof d.next_token === "string" && d.next_token ? d.next_token : null;
      if (!next) break;
    }
    return rows;
  };
  return {
    id: "OURA",
    authorize(state) {
      const u = new URL(AUTH_URL);
      u.search = new URLSearchParams({ response_type: "code", client_id: cfg.clientId, redirect_uri: cfg.redirectUri, state }).toString();
      return { url: u.toString() };
    },
    async exchange(code, _v, f): Promise<ConnectResult> {
      const t = await token(f, { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri });
      const me = await f(`${API}/v2/usercollection/personal_info`, { headers: { authorization: `Bearer ${t.accessToken}` } });
      const info = me.ok ? await readJson(me) : {};
      return { ...t, externalId: typeof info.id === "string" ? info.id : null, externalName: null };
    },
    refresh: (refreshToken, f) => token(f, { grant_type: "refresh_token", refresh_token: refreshToken }),
    async revoke(accessToken, f) {
      await f(`${API}/oauth/revoke?access_token=${encodeURIComponent(accessToken)}`).catch(() => undefined);
    },
    async fetch(accessToken, _account, startIso, endIso, f): Promise<SyncedData> {
      // Ask up to endIso (whether Oura treats end_date as inclusive or not) and filter below.
      const [activity, workouts, sleep] = [
        await collection(f, accessToken, "daily_activity", startIso, endIso),
        await collection(f, accessToken, "workout", startIso, endIso),
        await collection(f, accessToken, "sleep", startIso, endIso),
      ];
      return { daily: parseOura({ activity, workouts, sleep }).filter((r) => r.date >= startIso && r.date < endIso), events: [] };
    },
  };
}

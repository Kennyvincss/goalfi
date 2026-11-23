/**
 * Google Health API (replacement for the Fitbit Web API). Field names come from Google's generated
 * client (googleapis `health/v4`): dailyRollUp → `rollupDataPoints[]` with `civilStartTime` and
 * per-type values (`steps.countSum`, `distance.millimetersSum`, `floors.countSum`,
 * `activeZoneMinutes.sumIn{FatBurn,Cardio,Peak}HeartZone`); list → `dataPoints[]` with `exercise` /
 * `sleep` sessions whose `interval` carries `civilStartTime` / `civilEndTime`.
 */
import { addDays, readJson, ProviderError, type ConnectResult, type Fetch, type ProviderClient, type SyncedData, type TokenSet } from "./http";

export const GOOGLE_HEALTH_SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
];
export const GOOGLE_SLEEP_SCOPE = GOOGLE_HEALTH_SCOPES[1]!;
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://health.googleapis.com/v4/users/me/dataTypes";
/** Workouts shorter than this don't count (e.g. auto-detected walks to the car). */
export const MIN_WORKOUT_SECONDS = 10 * 60;

export interface GoogleHealthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

type Civil = { date?: { year?: number; month?: number; day?: number }; time?: { hours?: number; minutes?: number } };
function civil(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return { date: { year, month, day }, time: { hours: 0, minutes: 0 } };
}
export function isoFromCivil(c: unknown): string | null {
  const d = (c as Civil | undefined)?.date;
  if (!d?.year || !d.month || !d.day) return null;
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}
const num = (v: unknown) => (v === undefined || v === null || v === "" ? NaN : Number(v));
/** Google JSON Duration, e.g. "1800s" or "1800.5s". */
const seconds = (v: unknown) => (typeof v === "string" && /^[\d.]+s$/.test(v) ? parseFloat(v) : NaN);

/** Rollup value extractors, keyed by our metric id. */
const ROLLUPS: { metric: string; dataType: string; value: (p: Record<string, unknown>) => number }[] = [
  { metric: "steps", dataType: "steps", value: (p) => num((p.steps as Record<string, unknown> | undefined)?.countSum) },
  { metric: "distance_km", dataType: "distance", value: (p) => num((p.distance as Record<string, unknown> | undefined)?.millimetersSum) / 1_000_000 },
  { metric: "floors", dataType: "floors", value: (p) => num((p.floors as Record<string, unknown> | undefined)?.countSum) },
  {
    metric: "heart_zone_minutes", dataType: "active-zone-minutes",
    value: (p) => {
      const z = p.activeZoneMinutes as Record<string, unknown> | undefined;
      if (!z) return NaN;
      return ["sumInFatBurnHeartZone", "sumInCardioHeartZone", "sumInPeakHeartZone"].reduce((a, k) => a + (Number.isFinite(num(z[k])) ? num(z[k]) : 0), 0);
    },
  },
];

/** Parse a dailyRollUp response for one metric. */
export function parseDailyRollup(body: unknown, metric = "steps"): { rows: { date: string; value: number }[]; nextPageToken: string | null } {
  const obj = (body ?? {}) as Record<string, unknown>;
  const spec = ROLLUPS.find((r) => r.metric === metric) ?? ROLLUPS[0]!;
  const list = Array.isArray(obj.rollupDataPoints) ? (obj.rollupDataPoints as Record<string, unknown>[]) : [];
  const rows: { date: string; value: number }[] = [];
  for (const p of list) {
    const date = isoFromCivil(p.civilStartTime);
    const value = spec.value(p);
    if (date && Number.isFinite(value)) rows.push({ date, value: Math.round(value * 100) / 100 });
  }
  return { rows, nextPageToken: typeof obj.nextPageToken === "string" && obj.nextPageToken ? obj.nextPageToken : null };
}

/** Workouts per local start date (sessions with ≥ MIN_WORKOUT_SECONDS active time). */
export function countWorkouts(points: Record<string, unknown>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of points) {
    const e = p.exercise as Record<string, unknown> | undefined;
    const interval = e?.interval as Record<string, unknown> | undefined;
    const date = isoFromCivil(interval?.civilStartTime);
    if (!e || !date) continue;
    let secs = seconds(e.activeDuration);
    if (!Number.isFinite(secs) && interval?.startTime && interval?.endTime)
      secs = (Date.parse(String(interval.endTime)) - Date.parse(String(interval.startTime))) / 1000;
    if (secs >= MIN_WORKOUT_SECONDS) out.set(date, (out.get(date) ?? 0) + 1);
  }
  return out;
}

/** Wake-up time (minutes after local midnight) per local date, from each day's main sleep. Naps are ignored. */
export function wakeTimes(points: Record<string, unknown>[]): Map<string, number> {
  const best = new Map<string, { main: boolean; length: number; wake: number }>();
  for (const p of points) {
    const s = p.sleep as Record<string, unknown> | undefined;
    const interval = s?.interval as Record<string, unknown> | undefined;
    const meta = (s?.metadata ?? {}) as Record<string, unknown>;
    const end = interval?.civilEndTime as Civil | undefined;
    const date = isoFromCivil(end);
    if (!s || !date || meta.nap === true) continue;
    const wake = (end?.time?.hours ?? 0) * 60 + (end?.time?.minutes ?? 0);
    const length = Date.parse(String(interval?.endTime)) - Date.parse(String(interval?.startTime));
    const cand = { main: meta.mainSleep === true, length: Number.isFinite(length) ? length : 0, wake };
    const cur = best.get(date);
    if (!cur || (cand.main && !cur.main) || (cand.main === cur.main && cand.length > cur.length)) best.set(date, cand);
  }
  return new Map([...best].map(([d, v]) => [d, v.wake]));
}

async function call(f: Fetch, url: string, token: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const r = await f(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const d = await readJson(r);
  if (!r.ok) {
    const msg = JSON.stringify(d.error ?? d).slice(0, 300);
    throw new ProviderError(`Google Health API ${r.status}: ${msg}`, r.status, r.status === 401 || r.status === 403);
  }
  return d;
}

async function tokenRequest(f: Fetch, body: Record<string, string>): Promise<TokenSet> {
  const r = await f(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
  const d = await readJson(r);
  if (!r.ok) throw new ProviderError(`Google sign-in failed: ${String(d.error_description ?? d.error ?? r.status)}`, r.status, d.error === "invalid_grant");
  return {
    accessToken: String(d.access_token),
    refreshToken: typeof d.refresh_token === "string" ? d.refresh_token : null,
    expiresAt: new Date(Date.now() + Number(d.expires_in ?? 3600) * 1000),
    scope: String(d.scope ?? GOOGLE_HEALTH_SCOPES.join(" ")),
  };
}

export function googleHealthProvider(cfg: GoogleHealthConfig): ProviderClient {
  return {
    id: "GOOGLE_HEALTH",
    authorize(state) {
      const u = new URL(AUTH_URL);
      u.search = new URLSearchParams({
        client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: "code", scope: GOOGLE_HEALTH_SCOPES.join(" "),
        access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
      }).toString();
      return { url: u.toString() };
    },
    async exchange(code, _verifier, f): Promise<ConnectResult> {
      const t = await tokenRequest(f, { grant_type: "authorization_code", code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri });
      return { ...t, externalId: null, externalName: null };
    },
    refresh: (refreshToken, f) => tokenRequest(f, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret }),
    async revoke(token, f) {
      await f(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } }).catch(() => undefined);
    },
    async fetch(token, account, startIso, endIso, f): Promise<SyncedData> {
      const daily: SyncedData["daily"] = [];
      for (const spec of ROLLUPS) {
        let pageToken: string | null = null;
        for (let page = 0; page < 10; page++) {
          const d = await call(f, `${API}/${spec.dataType}/dataPoints:dailyRollUp`, token, {
            method: "POST",
            body: JSON.stringify({ range: { start: civil(startIso), end: civil(endIso) }, windowSizeDays: 1, ...(pageToken ? { pageToken } : {}) }),
          });
          const parsed = parseDailyRollup(d, spec.metric);
          daily.push(...parsed.rows.map((r) => ({ metric: spec.metric, ...r })));
          if (!parsed.nextPageToken) break;
          pageToken = parsed.nextPageToken;
        }
      }
      const list = async (dataType: string, filter: string) => {
        const points: Record<string, unknown>[] = [];
        let pageToken: string | null = null;
        for (let page = 0; page < 20; page++) {
          const q = new URLSearchParams({ filter, pageSize: "25", ...(pageToken ? { pageToken } : {}) });
          const d = await call(f, `${API}/${dataType}/dataPoints?${q}`, token);
          points.push(...((Array.isArray(d.dataPoints) ? d.dataPoints : []) as Record<string, unknown>[]));
          pageToken = typeof d.nextPageToken === "string" && d.nextPageToken ? d.nextPageToken : null;
          if (!pageToken) break;
        }
        return points;
      };
      const workouts = countWorkouts(await list("exercise", `exercise.interval.civil_start_time >= "${startIso}" AND exercise.interval.civil_start_time < "${endIso}"`));
      // Days with no workout are real zeros once the day has data from the watch (steps rollup present).
      const daysWithData = new Set(daily.filter((r) => r.metric === "steps").map((r) => r.date));
      for (const date of new Set([...daysWithData, ...workouts.keys()])) daily.push({ metric: "workouts", date, value: workouts.get(date) ?? 0 });
      if (account.scope.includes(GOOGLE_SLEEP_SCOPE)) {
        const wakes = wakeTimes(await list("sleep", `sleep.interval.civil_end_time >= "${startIso}" AND sleep.interval.civil_end_time < "${endIso}"`));
        for (const [date, value] of wakes) daily.push({ metric: "wake_time", date, value });
      }
      return { daily, events: [] };
    },
  };
}

export { addDays };

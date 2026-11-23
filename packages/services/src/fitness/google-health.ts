/**
 * Google Health API client (Fitbit / Pixel Watch data; replaced the Fitbit Web API in Nov 2026).
 *
 * Verified from Google's docs (via search; developers.google.com was not reachable from the dev sandbox):
 *  - POST https://health.googleapis.com/v4/users/me/dataTypes/{type}/dataPoints:dailyRollUp
 *  - body: { range: CivilTimeInterval{ start, end: CivilDateTime{ date{year,month,day}, time } }, windowSizeDays }
 *    (start inclusive, end exclusive)
 *  - each result: { civilStartTime: CivilDateTime, civilEndTime, steps: { countSum } }
 *  - scope https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly
 * NOT verified: the name of the response array and paging field. parseDailyRollup() therefore
 * accepts any top-level array of points that carry civilStartTime, and looks for "nextPageToken".
 */
export const GOOGLE_HEALTH_SCOPE = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://health.googleapis.com/v4/users/me/dataTypes";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface GoogleHealthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenKey: string;
}

export function googleHealthConfigFromEnv(appUrl: string, env: Record<string, string | undefined> = process.env): GoogleHealthConfig | null {
  const clientId = env.GOOGLE_HEALTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_HEALTH_CLIENT_SECRET?.trim();
  const tokenKey = env.FITNESS_TOKEN_KEY?.trim();
  if (!clientId || !clientSecret || !tokenKey) return null;
  return { clientId, clientSecret, tokenKey, redirectUri: new URL("/api/fitness/google/callback", appUrl).toString() };
}

export function googleHealthAuthUrl(cfg: GoogleHealthConfig, state: string): string {
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GOOGLE_HEALTH_SCOPE,
    access_type: "offline", // refresh token, so syncing keeps working
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return u.toString();
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
}

export class GoogleHealthError extends Error {
  constructor(message: string, readonly status: number, readonly reconnect: boolean) {
    super(message);
  }
}

async function tokenRequest(f: Fetch, body: Record<string, string>): Promise<TokenSet> {
  const r = await f(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
  const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new GoogleHealthError(`Google sign-in failed: ${String(d.error_description ?? d.error ?? r.status)}`, r.status, d.error === "invalid_grant");
  return {
    accessToken: String(d.access_token),
    refreshToken: typeof d.refresh_token === "string" ? d.refresh_token : null,
    expiresAt: new Date(Date.now() + Number(d.expires_in ?? 3600) * 1000),
    scope: String(d.scope ?? GOOGLE_HEALTH_SCOPE),
  };
}

export function exchangeCode(cfg: GoogleHealthConfig, code: string, f: Fetch = fetch): Promise<TokenSet> {
  return tokenRequest(f, { grant_type: "authorization_code", code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri });
}

export function refreshAccessToken(cfg: GoogleHealthConfig, refreshToken: string, f: Fetch = fetch): Promise<TokenSet> {
  return tokenRequest(f, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret });
}

export async function revokeToken(token: string, f: Fetch = fetch): Promise<void> {
  await f(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" } }).catch(() => undefined);
}

/** "YYYY-MM-DD" → CivilDateTime at midnight. */
function civil(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return { date: { year, month, day }, time: { hours: 0, minutes: 0 } };
}

function isoFromCivil(c: unknown): string | null {
  const d = (c as { date?: { year?: number; month?: number; day?: number } })?.date;
  if (!d?.year || !d.month || !d.day) return null;
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** Extract { date, steps } rows from a dailyRollUp response (tolerant of the wrapper field name). */
export function parseDailyRollup(body: unknown): { rows: { date: string; value: number }[]; nextPageToken: string | null } {
  const obj = (body ?? {}) as Record<string, unknown>;
  const list = Object.values(obj).find(
    (v): v is Record<string, unknown>[] => Array.isArray(v) && v.some((p) => p && typeof p === "object" && "civilStartTime" in (p as object)),
  ) ?? [];
  const rows: { date: string; value: number }[] = [];
  for (const p of list) {
    const date = isoFromCivil(p.civilStartTime);
    const steps = p.steps as Record<string, unknown> | undefined;
    // int64 values arrive as JSON strings in Google APIs.
    const raw = steps?.countSum ?? steps?.count;
    const value = raw === undefined ? NaN : Number(raw);
    if (date && Number.isFinite(value)) rows.push({ date, value });
  }
  return { rows, nextPageToken: typeof obj.nextPageToken === "string" && obj.nextPageToken ? obj.nextPageToken : null };
}

/** Daily step totals for [startIso, endIsoExclusive). */
export async function fetchDailySteps(accessToken: string, startIso: string, endIsoExclusive: string, f: Fetch = fetch): Promise<{ date: string; value: number }[]> {
  const out: { date: string; value: number }[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 20; page++) {
    const r = await f(`${API}/steps/dataPoints:dailyRollUp`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ range: { start: civil(startIso), end: civil(endIsoExclusive) }, windowSizeDays: 1, ...(pageToken ? { pageToken } : {}) }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = JSON.stringify((d as { error?: unknown }).error ?? d).slice(0, 300);
      throw new GoogleHealthError(`Google Health API ${r.status}: ${msg}`, r.status, r.status === 401 || r.status === 403);
    }
    const parsed = parseDailyRollup(d);
    out.push(...parsed.rows);
    if (!parsed.nextPageToken) break;
    pageToken = parsed.nextPageToken;
  }
  return out;
}

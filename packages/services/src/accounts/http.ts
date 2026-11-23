export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A provider call failed. `reconnect` = the user must sign in again (revoked/expired access). */
export class ProviderError extends Error {
  constructor(message: string, readonly status: number, readonly reconnect: boolean) {
    super(message);
  }
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
}

export interface SyncedData {
  /** Totals per local calendar day. */
  daily: { metric: string; date: string; value: number }[];
  /** Timestamped activities, counted per challenge day. */
  events: { metric: string; externalId: string; occurredAt: Date; value: number; groupKey?: string | null }[];
}

export interface ConnectResult extends TokenSet {
  externalId: string | null;
  externalName: string | null;
}

/** One connectable data source. All network access goes through `f` so tests can fake it. */
export interface ProviderClient {
  id: "GOOGLE_HEALTH" | "GITHUB" | "LICHESS";
  /** URL to send the user to. `verifier` (PKCE) must be kept server-side until the callback. */
  authorize(state: string): { url: string; verifier?: string };
  exchange(code: string, verifier: string | undefined, f: Fetch): Promise<ConnectResult>;
  refresh?(refreshToken: string, f: Fetch): Promise<TokenSet>;
  revoke(token: string, f: Fetch): Promise<void>;
  /** Data for local days [startIso, endIsoExclusive). */
  fetch(token: string, account: { externalId: string | null; externalName: string | null; scope: string }, startIso: string, endIsoExclusive: string, f: Fetch): Promise<SyncedData>;
}

export async function readJson(r: Response): Promise<Record<string, unknown>> {
  return ((await r.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

/** Newline-delimited JSON (Lichess streams). */
export async function readNdjson(r: Response): Promise<Record<string, unknown>[]> {
  const text = await r.text();
  return text.split("\n").map((l) => l.trim()).filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => isoDay(new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000));

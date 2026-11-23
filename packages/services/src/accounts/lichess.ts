/**
 * Lichess (per the official OpenAPI spec, @lichess-org/types): OAuth2 authorization code + PKCE with
 * no app registration (`client_id` is any identifier), POST /api/token, DELETE /api/token,
 * GET /api/account, GET /api/games/user/{username} (ndjson; `createdAt`, `lastMoveAt`, `status`),
 * GET /api/puzzle/activity (ndjson; `date`, `puzzle.id`, `win`; scope puzzle:read).
 */
import { createHash, randomBytes } from "node:crypto";
import { readJson, readNdjson, ProviderError, type ConnectResult, type ProviderClient, type SyncedData } from "./http";

const BASE = "https://lichess.org";
export const LICHESS_SCOPE = "puzzle:read";
/** Statuses of games that never really happened or are still running. */
const NOT_PLAYED = new Set(["created", "started", "aborted", "noStart"]);

export interface LichessConfig {
  /** Any identifier for this app (Lichess has no app registration). */
  clientId: string;
  redirectUri: string;
}

const b64url = (b: Buffer) => b.toString("base64url");

export function lichessProvider(cfg: LichessConfig): ProviderClient {
  const ok = async (r: Response, what: string) => {
    if (r.ok) return;
    const d = await readJson(r.clone());
    throw new ProviderError(`Lichess ${what} ${r.status}: ${String(d.error ?? d.error_description ?? "").slice(0, 200)}`, r.status, r.status === 401);
  };
  return {
    id: "LICHESS",
    authorize(state) {
      const verifier = b64url(randomBytes(32));
      const challenge = b64url(createHash("sha256").update(verifier).digest());
      const u = new URL(`${BASE}/oauth`);
      u.search = new URLSearchParams({
        response_type: "code", client_id: cfg.clientId, redirect_uri: cfg.redirectUri,
        code_challenge_method: "S256", code_challenge: challenge, scope: LICHESS_SCOPE, state,
      }).toString();
      return { url: u.toString(), verifier };
    },
    async exchange(code, verifier, f): Promise<ConnectResult> {
      if (!verifier) throw new ProviderError("Lichess sign-in expired, please try again", 400, false);
      const r = await f(`${BASE}/api/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: cfg.redirectUri, client_id: cfg.clientId }).toString(),
      });
      const d = await readJson(r);
      if (!r.ok || typeof d.access_token !== "string") throw new ProviderError(`Lichess sign-in failed: ${String(d.error_description ?? d.error ?? r.status)}`, r.status, false);
      const token = d.access_token;
      const me = await f(`${BASE}/api/account`, { headers: { authorization: `Bearer ${token}` } });
      await ok(me, "account");
      const acct = await readJson(me);
      return {
        accessToken: token, refreshToken: null, scope: LICHESS_SCOPE,
        expiresAt: new Date(Date.now() + Number(d.expires_in ?? 365 * 86_400) * 1000),
        externalId: typeof acct.id === "string" ? acct.id : null, externalName: typeof acct.username === "string" ? acct.username : null,
      };
    },
    async revoke(token, f) {
      await f(`${BASE}/api/token`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
    },
    async fetch(token, account, startIso, endIso, f): Promise<SyncedData> {
      if (!account.externalId) throw new ProviderError("Lichess account unknown: reconnect", 400, true);
      // Instants with a one-day margin either side; challenge days are cut from these later.
      const since = Date.parse(`${startIso}T00:00:00Z`) - 86_400_000, until = Date.parse(`${endIso}T00:00:00Z`) + 86_400_000;
      const events: SyncedData["events"] = [];
      // Lichess asks clients to make one request at a time, so these run sequentially.
      const g = await f(`${BASE}/api/games/user/${encodeURIComponent(account.externalId)}?${new URLSearchParams({ since: String(since), until: String(until), max: "1000", moves: "false" })}`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/x-ndjson" },
      });
      await ok(g, "games");
      for (const game of await readNdjson(g)) {
        if (typeof game.id !== "string" || NOT_PLAYED.has(String(game.status))) continue;
        const at = Number(game.lastMoveAt ?? game.createdAt);
        if (Number.isFinite(at)) events.push({ metric: "lichess_games", externalId: game.id, occurredAt: new Date(at), value: 1 });
      }
      const p = await f(`${BASE}/api/puzzle/activity?${new URLSearchParams({ since: String(since), max: "2000" })}`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/x-ndjson" },
      });
      await ok(p, "puzzle activity");
      for (const a of await readNdjson(p)) {
        const at = Number(a.date), id = (a.puzzle as { id?: unknown } | undefined)?.id;
        if (a.win !== true || typeof id !== "string" || !Number.isFinite(at) || at >= until) continue;
        events.push({ metric: "lichess_puzzles", externalId: `${id}:${at}`, occurredAt: new Date(at), value: 1 });
      }
      return { daily: [], events };
    },
  };
}

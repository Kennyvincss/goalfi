/**
 * GitHub: OAuth app web flow (as implemented by @octokit/oauth-methods) and the GraphQL
 * contribution calendar (`viewer.contributionsCollection(from, to).contributionCalendar.weeks[].
 * contributionDays[] { date, contributionCount }`, per the @octokit/graphql-schema SDL).
 * OAuth-app tokens don't expire; no scope is requested, so only public data is readable.
 */
import { readJson, ProviderError, type ConnectResult, type ProviderClient, type SyncedData } from "./http";

export interface GitHubConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const NEVER = () => new Date(Date.now() + 10 * 365 * 86_400_000);

export function parseContributionCalendar(body: unknown): { login: string | null; days: { date: string; value: number }[] } {
  const viewer = ((body as { data?: { viewer?: Record<string, unknown> } })?.data?.viewer ?? {}) as Record<string, unknown>;
  const cal = (viewer.contributionsCollection as { contributionCalendar?: { weeks?: { contributionDays?: { date?: string; contributionCount?: number }[] }[] } } | undefined)
    ?.contributionCalendar;
  const days = (cal?.weeks ?? []).flatMap((w) => w.contributionDays ?? [])
    .filter((d) => typeof d.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && typeof d.contributionCount === "number")
    .map((d) => ({ date: d.date!, value: d.contributionCount! }));
  return { login: typeof viewer.login === "string" ? viewer.login : null, days };
}

export function githubProvider(cfg: GitHubConfig): ProviderClient {
  return {
    id: "GITHUB",
    authorize(state) {
      const u = new URL("https://github.com/login/oauth/authorize");
      u.search = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirectUri, state, allow_signup: "false" }).toString();
      return { url: u.toString() };
    },
    async exchange(code, _v, f): Promise<ConnectResult> {
      const r = await f("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: cfg.redirectUri }),
      });
      const d = await readJson(r);
      // GitHub reports OAuth errors in a 200 body.
      if (!r.ok || d.error || typeof d.access_token !== "string")
        throw new ProviderError(`GitHub sign-in failed: ${String(d.error_description ?? d.error ?? r.status)}`, r.ok ? 400 : r.status, false);
      const token = d.access_token;
      const me = await graphql(f, token, "query { viewer { login databaseId } }");
      const viewer = (me.data as { viewer?: { login?: string; databaseId?: number } } | undefined)?.viewer;
      return { accessToken: token, refreshToken: null, expiresAt: NEVER(), scope: String(d.scope ?? ""), externalId: viewer?.databaseId ? String(viewer.databaseId) : null, externalName: viewer?.login ?? null };
    },
    async revoke(token, f) {
      await f(`https://api.github.com/applications/${cfg.clientId}/token`, {
        method: "DELETE",
        headers: { authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`, accept: "application/vnd.github+json", "content-type": "application/json" },
        body: JSON.stringify({ access_token: token }),
      }).catch(() => undefined);
    },
    async fetch(token, _account, startIso, endIso, f): Promise<SyncedData> {
      const to = new Date(new Date(`${endIso}T00:00:00Z`).getTime() - 1000).toISOString();
      const d = await graphql(f, token, `query($from: DateTime!, $to: DateTime!) { viewer { login contributionsCollection(from: $from, to: $to) { contributionCalendar { weeks { contributionDays { date contributionCount } } } } } }`, {
        from: `${startIso}T00:00:00Z`, to,
      });
      const { days } = parseContributionCalendar(d);
      return { daily: days.filter((x) => x.date >= startIso && x.date < endIso).map((x) => ({ metric: "github_contributions", ...x })), events: [] };
    },
  };
}

async function graphql(f: Parameters<ProviderClient["fetch"]>[4], token: string, query: string, variables?: Record<string, unknown>) {
  const r = await f("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const d = await readJson(r);
  if (!r.ok || Array.isArray(d.errors)) {
    const msg = JSON.stringify(d.errors ?? d.message ?? d).slice(0, 300);
    throw new ProviderError(`GitHub API ${r.status}: ${msg}`, r.status, r.status === 401);
  }
  return d;
}

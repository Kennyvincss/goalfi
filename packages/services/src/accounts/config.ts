import type { AccountProviderId } from "@goalfi/core";
import { githubProvider } from "./github";
import { googleHealthProvider } from "./google-health";
import type { ProviderClient } from "./http";
import { lichessProvider } from "./lichess";

export interface AccountsConfig {
  /** Encrypts provider tokens at rest. */
  tokenKey: string;
  providers: Partial<Record<AccountProviderId, ProviderClient>>;
  telegram: { botToken: string; apiRoot?: string } | null;
}

export const callbackPath = (p: AccountProviderId) => `/api/accounts/${p === "GOOGLE_HEALTH" ? "google" : p.toLowerCase()}/callback`;
export const providerFromSlug = (slug: string): AccountProviderId | null =>
  ({ google: "GOOGLE_HEALTH", github: "GITHUB", lichess: "LICHESS" } as const)[slug as "google"] ?? null;
export const providerSlug = (p: AccountProviderId) => (p === "GOOGLE_HEALTH" ? "google" : p.toLowerCase());

/**
 * Providers configured on this server. Lichess needs no registration, so it's on whenever
 * ACCOUNT_TOKEN_KEY is set; Google Health and GitHub need their OAuth client keys.
 */
export function accountsConfigFromEnv(appUrl: string, env: Record<string, string | undefined> = process.env): AccountsConfig | null {
  const tokenKey = env.ACCOUNT_TOKEN_KEY?.trim();
  if (!tokenKey || tokenKey.length < 32) return null;
  const url = (p: AccountProviderId) => new URL(callbackPath(p), appUrl).toString();
  const providers: AccountsConfig["providers"] = { LICHESS: lichessProvider({ clientId: new URL(appUrl).host, redirectUri: url("LICHESS") }) };
  const gid = env.GOOGLE_HEALTH_CLIENT_ID?.trim(), gsecret = env.GOOGLE_HEALTH_CLIENT_SECRET?.trim();
  if (gid && gsecret) providers.GOOGLE_HEALTH = googleHealthProvider({ clientId: gid, clientSecret: gsecret, redirectUri: url("GOOGLE_HEALTH") });
  const hid = env.GITHUB_CLIENT_ID?.trim(), hsecret = env.GITHUB_CLIENT_SECRET?.trim();
  if (hid && hsecret) providers.GITHUB = githubProvider({ clientId: hid, clientSecret: hsecret, redirectUri: url("GITHUB") });
  const bot = env.TELEGRAM_BOT_TOKEN?.trim();
  return { tokenKey, providers, telegram: bot ? { botToken: bot, apiRoot: env.TELEGRAM_API_ROOT?.trim() || undefined } : null };
}

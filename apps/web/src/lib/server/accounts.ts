import "server-only";
import { accountsConfigFromEnv, resolveAppUrl, type AccountsConfig } from "@goalfi/services";

/** Connected-account providers configured on this server, or null without ACCOUNT_TOKEN_KEY. */
export function accountsConfig(): AccountsConfig | null {
  try {
    return accountsConfigFromEnv(resolveAppUrl(process.env).url, process.env);
  } catch {
    return null;
  }
}

export const ACCOUNT_STATE_COOKIE = "goalfi_account_state";

/** Sources this site can use: configured accounts, plus GoalFi and Telegram counts. */
export function configuredSources(): Set<string> {
  const cfg = accountsConfig();
  return new Set<string>([...Object.keys(cfg?.providers ?? {}), "GOALFI", ...(cfg?.telegram ? ["TELEGRAM"] : [])]);
}

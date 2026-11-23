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

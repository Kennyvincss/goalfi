import "server-only";
import { googleHealthConfigFromEnv, resolveAppUrl, type GoogleHealthConfig } from "@goalfi/services";

/** Google Health OAuth config, or null when the three env vars aren't all set. */
export function fitnessConfig(): GoogleHealthConfig | null {
  try {
    return googleHealthConfigFromEnv(resolveAppUrl(process.env).url, process.env);
  } catch {
    return null;
  }
}

export const FITNESS_STATE_COOKIE = "goalfi_fitness_state";

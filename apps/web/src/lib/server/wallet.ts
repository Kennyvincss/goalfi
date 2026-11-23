import "server-only";
import { resolveAppUrl } from "@goalfi/services";

/** Domain embedded in the wallet-link message (binds signatures to this deployment). */
export function linkDomain(): string {
  return new URL(resolveAppUrl(process.env).url).host;
}

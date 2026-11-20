import "server-only";

/** Domain embedded in the wallet-link message (binds signatures to this deployment). */
export function linkDomain(): string {
  return new URL(process.env.GOALFI_APP_URL ?? "http://localhost:3000").host;
}

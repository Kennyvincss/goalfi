/**
 * The site's public origin, tolerant of common setup mistakes:
 * - GOALFI_APP_URL without a scheme ("goalfi.vercel.app") gets https://
 * - trailing slashes or paths are dropped (origin only)
 * - when unset on Vercel, falls back to the production domain Vercel provides
 */
export interface AppUrlInfo {
  url: string;
  source: "GOALFI_APP_URL" | "GOALFI_APP_URL (fixed)" | "VERCEL_PROJECT_PRODUCTION_URL" | "default";
  problem: string | null;
}

export function resolveAppUrl(env: Record<string, string | undefined> = process.env): AppUrlInfo {
  const raw = env.GOALFI_APP_URL?.trim();
  if (raw) {
    const hasScheme = /^https?:\/\//i.test(raw);
    try {
      const u = new URL(hasScheme ? raw : `https://${raw}`);
      const fixed = !hasScheme || u.origin !== raw;
      return {
        url: u.origin,
        source: fixed ? "GOALFI_APP_URL (fixed)" : "GOALFI_APP_URL",
        problem: !hasScheme ? `GOALFI_APP_URL should start with https:// (using ${u.origin})` : null,
      };
    } catch {
      // fall through to the fallbacks below
    }
  }
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return { url: `https://${vercel.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`, source: "VERCEL_PROJECT_PRODUCTION_URL", problem: raw ? `GOALFI_APP_URL “${raw}” is not a valid address` : "GOALFI_APP_URL is not set (using Vercel's production domain)" };
  return { url: "http://localhost:3000", source: "default", problem: raw ? `GOALFI_APP_URL “${raw}” is not a valid address` : "GOALFI_APP_URL is not set" };
}

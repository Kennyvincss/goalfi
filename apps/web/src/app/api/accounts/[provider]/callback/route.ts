import { NextResponse, type NextRequest } from "next/server";
import { connectAccount, providerFromSlug, ProviderError, ServiceError } from "@goalfi/services";
import { getCurrentUser } from "@/lib/server/auth";
import { actorOf, services } from "@/lib/server/services";
import { ACCOUNT_STATE_COOKIE, accountsConfig } from "@/lib/server/accounts";

export const maxDuration = 30;

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: slug } = await params;
  const provider = providerFromSlug(slug);
  const back = (reason: string) => {
    const r = NextResponse.redirect(new URL(`/settings?account=${reason}&provider=${slug}#accounts`, req.url));
    r.cookies.delete({ name: ACCOUNT_STATE_COOKIE, path: "/api/accounts" });
    return r;
  };
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/settings%23accounts", req.url));
  const cfg = accountsConfig();
  if (!provider || !cfg?.providers[provider]) return back("not_configured");
  const q = req.nextUrl.searchParams;
  if (q.get("error")) return back(q.get("error") === "access_denied" ? "denied" : "failed");
  let saved: { state?: string; provider?: string; verifier?: string; next?: string } = {};
  try {
    saved = JSON.parse(req.cookies.get(ACCOUNT_STATE_COOKIE)?.value ?? "{}");
  } catch {
    /* treated as missing */
  }
  const state = q.get("state");
  if (!state || !saved.state || state !== saved.state || saved.provider !== provider || !state.endsWith(`.${user.id}`)) return back("expired");
  const code = q.get("code");
  if (!code) return back("failed");
  try {
    await connectAccount(services(), actorOf(user), cfg, provider, code, saved.verifier);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 409) return back("in_use");
    console.error(`[accounts] ${provider} connect failed:`, e instanceof ProviderError ? `${e.status} ${e.message}` : e);
    return back("failed");
  }
  const next = saved.next ?? "/connected";
  const r = NextResponse.redirect(new URL(`${next}${next.includes("?") ? "&" : "?"}connected=${slug}`, req.url));
  r.cookies.delete({ name: ACCOUNT_STATE_COOKIE, path: "/api/accounts" });
  return r;
}

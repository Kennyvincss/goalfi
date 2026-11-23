import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { providerFromSlug, startConnect } from "@goalfi/services";
import { getCurrentUser } from "@/lib/server/auth";
import { ACCOUNT_STATE_COOKIE, accountsConfig } from "@/lib/server/accounts";

/** Start sign-in with a provider. The state cookie (and PKCE verifier for Lichess) protects the callback. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: slug } = await params;
  const provider = providerFromSlug(slug);
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/settings%23accounts", req.url));
  const cfg = accountsConfig();
  if (!provider || !cfg?.providers[provider]) return NextResponse.redirect(new URL(`/settings?account=not_configured#accounts`, req.url));
  const next = req.nextUrl.searchParams.get("next");
  const state = `${randomBytes(16).toString("base64url")}.${user.id}`;
  const { url, verifier } = startConnect(cfg, provider, state);
  const res = NextResponse.redirect(url);
  res.cookies.set(ACCOUNT_STATE_COOKIE, JSON.stringify({ state, provider, verifier, next: next?.startsWith("/") && !next.startsWith("//") ? next : "/connected" }), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/accounts", maxAge: 600,
  });
  return res;
}

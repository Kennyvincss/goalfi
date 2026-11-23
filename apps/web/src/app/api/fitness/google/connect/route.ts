import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { googleHealthAuthUrl } from "@goalfi/services";
import { getCurrentUser } from "@/lib/server/auth";
import { FITNESS_STATE_COOKIE, fitnessConfig } from "@/lib/server/fitness";

/** Start Google sign-in for read-only step access. The state cookie protects the callback from CSRF. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/settings%23fitness", req.url));
  const cfg = fitnessConfig();
  if (!cfg) return NextResponse.redirect(new URL("/settings?fitness=not_configured#fitness", req.url));
  const next = req.nextUrl.searchParams.get("next");
  const state = `${randomBytes(16).toString("base64url")}.${user.id}`;
  const res = NextResponse.redirect(googleHealthAuthUrl(cfg, state));
  res.cookies.set(FITNESS_STATE_COOKIE, JSON.stringify({ state, next: next?.startsWith("/") && !next.startsWith("//") ? next : "/fitness" }), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/fitness", maxAge: 600,
  });
  return res;
}

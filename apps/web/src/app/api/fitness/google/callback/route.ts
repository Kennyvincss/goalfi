import { NextResponse, type NextRequest } from "next/server";
import { connectGoogleHealth, GoogleHealthError } from "@goalfi/services";
import { getCurrentUser } from "@/lib/server/auth";
import { actorOf, services } from "@/lib/server/services";
import { FITNESS_STATE_COOKIE, fitnessConfig } from "@/lib/server/fitness";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const back = (reason: string) => {
    const r = NextResponse.redirect(new URL(`/settings?fitness=${reason}#fitness`, req.url));
    r.cookies.delete({ name: FITNESS_STATE_COOKIE, path: "/api/fitness" });
    return r;
  };
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=/settings%23fitness", req.url));
  const cfg = fitnessConfig();
  if (!cfg) return back("not_configured");
  const q = req.nextUrl.searchParams;
  if (q.get("error")) return back(q.get("error") === "access_denied" ? "denied" : "failed");
  let saved: { state?: string; next?: string } = {};
  try {
    saved = JSON.parse(req.cookies.get(FITNESS_STATE_COOKIE)?.value ?? "{}");
  } catch {
    /* treated as missing */
  }
  const state = q.get("state");
  if (!state || !saved.state || state !== saved.state || !state.endsWith(`.${user.id}`)) return back("expired");
  const code = q.get("code");
  if (!code) return back("failed");
  try {
    await connectGoogleHealth(services(), actorOf(user), cfg, code);
  } catch (e) {
    console.error("[fitness] connect failed:", e instanceof GoogleHealthError ? `${e.status} ${e.message}` : e);
    return back("failed");
  }
  const r = NextResponse.redirect(new URL(`${saved.next ?? "/fitness"}${(saved.next ?? "").includes("?") ? "&" : "?"}connected=1`, req.url));
  r.cookies.delete({ name: FITNESS_STATE_COOKIE, path: "/api/fitness" });
  return r;
}

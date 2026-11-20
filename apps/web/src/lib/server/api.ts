import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodType } from "zod";
import { prisma, type Prisma } from "@goalfi/db";
import { ServiceError } from "@goalfi/services";
import { HttpError } from "./auth";

/** JSON response that serializes bigint safely. */
export function json(data: unknown, init?: ResponseInit) {
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new HttpError(422, "Validation failed", z.flattenError(r.error as z.ZodError).fieldErrors);
  return r.data;
}

/** Wrap a route handler with consistent error handling. */
export function route<C>(handler: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof HttpError || err instanceof ServiceError) return json({ error: err.message, details: err.details }, { status: err.status });
      console.error("[api]", req.method, req.nextUrl.pathname, err);
      return json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Fixed-window rate limit stored in Postgres (works across serverless instances).
 * Throws 429 when `limit` is exceeded within `windowSecs`.
 */
export async function rateLimit(key: string, limit: number, windowSecs: number): Promise<void> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSecs * 1000);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "rate_limit_buckets" ("key", "count", "resetAt") VALUES (${key}, 1, ${resetAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "rate_limit_buckets"."resetAt" < ${now} THEN 1 ELSE "rate_limit_buckets"."count" + 1 END,
      "resetAt" = CASE WHEN "rate_limit_buckets"."resetAt" < ${now} THEN ${resetAt} ELSE "rate_limit_buckets"."resetAt" END
    RETURNING "count"`;
  if ((rows[0]?.count ?? 0) > limit) throw new HttpError(429, "Too many requests, slow down");
}

export async function audit(
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Prisma.InputJsonValue,
  ip?: string,
) {
  await prisma.auditLog.create({ data: { actorId, action, entityType, entityId, metadata, ip } });
}

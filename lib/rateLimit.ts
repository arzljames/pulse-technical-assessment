// Fixed-window rate limiting backed by Postgres (S3).
//
// Counters live in the database rather than in memory because serverless
// requests can land on different instances: an in-memory limit would be
// per-instance and trivially spread out. Each check is one atomic upsert.
import { prisma } from "@/lib/prisma";

export interface Limit {
  key: string; // e.g. "signal:<sessionId>" or "session-ip:<ip>"
  max: number; // requests allowed per window
  windowMs: number;
}

export const MINUTE = 60_000;

// Counts one hit against `limit`. Returns seconds until the window resets
// if it's exceeded, or 0 if the request may proceed.
async function hit({ key, max, windowMs }: Limit): Promise<number> {
  const secs = windowMs / 1000;
  const [row] = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count")
    VALUES (${key}, now(), 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimit"."windowStart" <= now() - make_interval(secs => ${secs}::double precision)
        THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE
        WHEN "RateLimit"."windowStart" <= now() - make_interval(secs => ${secs}::double precision)
        THEN now() ELSE "RateLimit"."windowStart" END
    RETURNING "count", "windowStart"`;
  if (row.count <= max) return 0;
  const resetsAt = row.windowStart.getTime() + windowMs;
  return Math.max(1, Math.ceil((resetsAt - Date.now()) / 1000));
}

// Checks every limit (all are counted). Returns a 429 response if any is
// exceeded, or null to continue. Fails open: if the counter itself errors,
// the request goes through rather than taking the app down with it.
export async function rateLimit(...limits: Limit[]): Promise<Response | null> {
  try {
    let retryAfter = 0;
    for (const limit of limits) retryAfter = Math.max(retryAfter, await hit(limit));
    if (retryAfter === 0) return null;
    return Response.json(
      { error: "rate limited", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  } catch (err) {
    console.error("[rateLimit] check failed, allowing request", err);
    return null;
  }
}

// Caller's IP. On Vercel `x-forwarded-for` is set by the platform (the
// first entry is the client); elsewhere it may be absent or spoofable, so
// per-IP limits are a backstop to the per-session ones, not a replacement.
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

// Drop counters whose window ended long ago.
export async function sweepRateLimits(): Promise<void> {
  await prisma.rateLimit.deleteMany({
    where: { windowStart: { lt: new Date(Date.now() - 60 * MINUTE) } },
  });
}

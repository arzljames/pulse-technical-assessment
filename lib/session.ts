// Server-side session auth (S1).
//
// A session has a public id (the dot's id, visible to everyone through
// /api/poll and used as fromId/toId in signals) and a secret token held only
// by the browser that owns it: `<id>.<HMAC-SHA256(id)>`. Every endpoint
// derives the caller's id from the token, never from the request body or
// query, so knowing someone's public id no longer lets you act as them.
//
// Tokens are stateless (verified by recomputing the HMAC), so they survive
// the presence row being reaped and a re-join keeps the same id.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const globalForSecret = globalThis as unknown as { pulseDevSecret?: Buffer };

function secret(): Buffer {
  const env = process.env.SESSION_SECRET;
  if (env && env.length >= 32) return Buffer.from(env);
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set (32+ characters) in production");
  }
  // Dev fallback: a random secret per server process (kept on globalThis so
  // hot reloads don't invalidate every open tab). Restarting the dev server
  // signs everyone out; their next poll gets a 401 and starts a new session.
  if (!globalForSecret.pulseDevSecret) {
    globalForSecret.pulseDevSecret = randomBytes(32);
    console.warn("[session] SESSION_SECRET not set; using a random dev secret");
  }
  return globalForSecret.pulseDevSecret;
}

function sign(id: string): string {
  return createHmac("sha256", secret()).update(id).digest("base64url");
}

export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function issueSession(): { id: string; token: string } {
  const id = randomUUID();
  return { id, token: `${id}.${sign(id)}` };
}

// The session id a token belongs to, or null if it's missing or forged.
export function verifyToken(token: unknown): string | null {
  if (typeof token !== "string" || token.length > 128) return null;
  const dot = token.indexOf(".");
  const id = token.slice(0, dot);
  if (dot < 0 || !isSessionId(id)) return null;
  const expected = Buffer.from(sign(id));
  const given = Buffer.from(token.slice(dot + 1));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  return id;
}

// Caller's session id from `Authorization: Bearer <token>`.
export function sessionFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return verifyToken(header.slice("Bearer ".length));
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

import type { NextRequest } from "next/server";
import { issueSession } from "@/lib/session";
import { clientIp, MINUTE, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/session — start an anonymous session. Returns the public `id`
// and the secret `token` the browser must send (as a Bearer token) to every
// other endpoint. Nothing is stored: the token is verified by its signature.
// Doesn't put you on the map; that's /api/join.
export async function POST(request: NextRequest) {
  // Per IP, since a caller has no session yet. Caps minting fresh identities
  // to dodge the per-session limits elsewhere.
  const limited = await rateLimit({
    key: `session-ip:${clientIp(request)}`,
    max: 20,
    windowMs: MINUTE,
  });
  if (limited) return limited;
  return Response.json(issueSession());
}

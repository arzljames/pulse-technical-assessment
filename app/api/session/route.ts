import { issueSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/session — start an anonymous session. Returns the public `id`
// and the secret `token` the browser must send (as a Bearer token) to every
// other endpoint. Nothing is stored: the token is verified by its signature.
// Doesn't put you on the map; that's /api/join.
export async function POST() {
  return Response.json(issueSession());
}

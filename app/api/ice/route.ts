import type { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { sessionFrom } from "@/lib/session";
import { MINUTE, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/ice — WebRTC ICE servers (S5).
//
// A direct peer-to-peer connection shows each side the other's public IP.
// With a TURN relay configured, "Hide my IP" mode connects relay-only, so the
// stranger only ever sees the relay's address.
//
//   no token     → { relayAvailable } (the landing page asks before joining)
//   Bearer token → { relayAvailable, iceServers } with short-lived TURN
//                  credentials (TURN REST API / coturn `use-auth-secret`), so
//                  no long-lived TURN password ever reaches the browser.
//
// Env: TURN_URLS (comma-separated, e.g. "turn:turn.example.com:3478,
// turns:turn.example.com:5349") and TURN_SECRET (coturn static-auth-secret).

const STUN = { urls: "stun:stun.l.google.com:19302" };
const TURN_TTL_SECONDS = 60 * 60;

function turnUrls(): string[] {
  return (process.env.TURN_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter((u) => /^turns?:/.test(u));
}

export async function GET(request: NextRequest) {
  const urls = turnUrls();
  const secret = process.env.TURN_SECRET;
  const relayAvailable = urls.length > 0 && !!secret;

  const id = sessionFrom(request);
  if (!id) return Response.json({ relayAvailable });

  const limited = await rateLimit({ key: `ice:${id}`, max: 30, windowMs: MINUTE });
  if (limited) return limited;

  const iceServers: RTCIceServer[] = [STUN];
  if (relayAvailable) {
    const username = `${Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS}:${id}`;
    const credential = createHmac("sha1", secret).update(username).digest("base64");
    iceServers.push({ urls, username, credential });
  }
  return Response.json({ relayAvailable, iceServers });
}

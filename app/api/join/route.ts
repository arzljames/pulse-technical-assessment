import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidLatLng } from "@/lib/geo";
import { placeDot } from "@/lib/privacy";
import { sessionFrom, unauthorized } from "@/lib/session";
import { clientIp, MINUTE, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/join — body { lat, lng } (raw coords), Bearer session token.
// Places the dot at the caller's ~2 km grid cell anchor (see lib/privacy.ts)
// and upserts their presence row. Raw coordinates are never stored.
export async function POST(request: NextRequest) {
  const id = sessionFrom(request);
  if (!id) return unauthorized();
  // Every join applies a fresh random offset, so unlimited re-joins would
  // also feed the location-averaging attack (S4).
  const limited = await rateLimit(
    { key: `join:${id}`, max: 10, windowMs: MINUTE },
    { key: `join-ip:${clientIp(request)}`, max: 60, windowMs: MINUTE },
  );
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { lat, lng } = (body ?? {}) as Record<string, unknown>;

  if (!isValidLatLng(lat, lng)) {
    return Response.json({ error: "invalid coordinates" }, { status: 400 });
  }

  const offset = placeDot(lat as number, lng as number);

  await prisma.presence.upsert({
    where: { id },
    create: {
      id,
      lat: offset.lat,
      lng: offset.lng,
      busy: false,
      lastSeen: new Date(),
    },
    update: {
      lat: offset.lat,
      lng: offset.lng,
      lastSeen: new Date(),
    },
  });

  return Response.json({ ok: true });
}

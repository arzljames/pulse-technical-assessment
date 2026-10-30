import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyPrivacyOffset, isValidLatLng } from "@/lib/geo";
import { sessionFrom, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/join — body { lat, lng } (raw coords), Bearer session token.
// Applies a 1–3 km privacy offset and upserts the caller's presence row. Raw
// coordinates are never stored.
export async function POST(request: NextRequest) {
  const id = sessionFrom(request);
  if (!id) return unauthorized();

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

  const offset = applyPrivacyOffset(lat as number, lng as number);

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

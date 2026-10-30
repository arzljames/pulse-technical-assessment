import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { STALE_MS, SIGNAL_TTL_MS } from "@/lib/presence";
import { sessionFrom, unauthorized } from "@/lib/session";
import type { PollResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/poll (Bearer session token) — the single endpoint that drives
// the live map.
// It (1) heartbeats the caller, (2) reaps stale presence + orphan signals,
// (3) returns the filtered online peers, and (4) drains this user's mailbox.
export async function GET(request: NextRequest) {
  // Only the token's owner can heartbeat this session or drain its mailbox.
  const id = sessionFrom(request);
  if (!id) return unauthorized();

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_MS);
  const signalCutoff = new Date(now - SIGNAL_TTL_MS);

  // 1) Heartbeat — refresh lastSeen for the caller. A zero count means the
  // caller has no presence row, so they're invisible until they re-join.
  const heartbeat = await prisma.presence.updateMany({
    where: { id },
    data: { lastSeen: new Date(now) },
  });

  // 2) Reap stale presence rows and orphaned signals (independent deletes —
  // no atomicity needed, and avoids transactions over a PgBouncer pooler).
  const stale = await prisma.presence.findMany({
    where: { lastSeen: { lt: staleCutoff } },
    select: { id: true },
  });
  if (stale.length > 0) {
    const staleIds = stale.map((s) => s.id);
    await prisma.presence.deleteMany({
      where: { id: { in: staleIds }, lastSeen: { lt: staleCutoff } },
    });
    // Free anyone connected to a reaped session and tell them it ended;
    // drop requests aimed at one. (S2: connection state must not point at
    // sessions that no longer exist.)
    const orphaned = await prisma.presence.findMany({
      where: { peerId: { in: staleIds } },
      select: { id: true, peerId: true },
    });
    if (orphaned.length > 0) {
      await prisma.presence.updateMany({
        where: { peerId: { in: staleIds } },
        data: { busy: false, peerId: null },
      });
      await prisma.signal.createMany({
        data: orphaned.map((o) => ({ fromId: o.peerId!, toId: o.id, type: "end" })),
      });
    }
    await prisma.presence.updateMany({
      where: { requestTo: { in: staleIds } },
      data: { requestTo: null },
    });
  }
  await prisma.signal.deleteMany({ where: { createdAt: { lt: signalCutoff } } });

  // 3) Online peers, excluding self.
  const peers = await prisma.presence.findMany({
    where: {
      id: { not: id },
      lastSeen: { gte: staleCutoff },
    },
    select: { id: true, lat: true, lng: true, busy: true },
  });

  // 4) Drain this user's mailbox: read, then delete exactly what we read so a
  // concurrently-inserted signal is never lost.
  const inbox = await prisma.signal.findMany({
    where: { toId: id },
    orderBy: { createdAt: "asc" },
  });
  if (inbox.length > 0) {
    await prisma.signal.deleteMany({
      where: { id: { in: inbox.map((s) => s.id) } },
    });
  }

  const response: PollResponse = {
    joined: heartbeat.count > 0,
    peers: peers.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      busy: p.busy,
    })),
    signals: inbox.map((s) => ({
      id: s.id,
      fromId: s.fromId,
      toId: s.toId,
      type: s.type as PollResponse["signals"][number]["type"],
      payload: s.payload,
      createdAt: s.createdAt.toISOString(),
    })),
  };

  return Response.json(response);
}

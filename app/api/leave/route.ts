import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/session";
import { readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { token }. Removes the caller's presence row and
// any pending signals to/from them, and ends whatever they were part of,
// using the server's own connection state (S2) rather than trusting the
// client to say who its peer was:
//   - the connected peer is freed and gets "end"
//   - the session we were requesting gets "end" (request withdrawn)
//   - anyone requesting us gets "end" (we're gone)
// Called via navigator.sendBeacon on tab close, which can't set headers, so
// the session token travels in the body (and the body may arrive as text).
export async function POST(request: NextRequest) {
  const parsed = await readJson(request, 1024);
  if (!parsed.ok) return parsed.response;

  const id = verifyToken(parsed.body.token);
  if (!id) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const me = await prisma.presence.findUnique({
    where: { id },
    select: { peerId: true, requestTo: true },
  });
  const requesters = await prisma.presence.findMany({
    where: { requestTo: id },
    select: { id: true },
  });

  // Independent cleanup deletes — no atomicity needed (and interactive
  // transactions are unreliable over a PgBouncer pooler).
  await prisma.signal.deleteMany({
    where: { OR: [{ toId: id }, { fromId: id }] },
  });
  await prisma.presence.deleteMany({ where: { id } });

  // Created after the cleanup above so they aren't deleted with the rest.
  const notify = new Set<string>(requesters.map((r) => r.id));
  if (me?.requestTo) notify.add(me.requestTo);
  if (me?.peerId) {
    notify.add(me.peerId);
    await prisma.presence.updateMany({
      where: { id: me.peerId, peerId: id },
      data: { busy: false, peerId: null },
    });
  }
  if (requesters.length > 0) {
    await prisma.presence.updateMany({
      where: { requestTo: id },
      data: { requestTo: null },
    });
  }
  if (notify.size > 0) {
    await prisma.signal.createMany({
      data: [...notify].map((toId) => ({ fromId: id, toId, type: "end" })),
    });
  }

  return Response.json({ ok: true });
}

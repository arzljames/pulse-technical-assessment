import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isSessionId, verifyToken } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { token, peerId? }. Removes the caller's presence
// row and any pending signals to/from them. If they were mid-connection,
// `peerId` is the other side: free them and tell them the connection ended.
// Called via navigator.sendBeacon on tab close, which can't set headers, so
// the session token travels in the body (and the body may arrive as text).
export async function POST(request: NextRequest) {
  let token: unknown;
  let peerId: unknown;
  try {
    const text = await request.text();
    const parsed = text ? JSON.parse(text) : undefined;
    token = parsed?.token;
    peerId = parsed?.peerId;
  } catch {
    token = undefined;
  }

  const id = verifyToken(token);
  if (!id) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Independent cleanup deletes — no atomicity needed (and interactive
  // transactions are unreliable over a PgBouncer pooler).
  await prisma.signal.deleteMany({
    where: { OR: [{ toId: id }, { fromId: id }] },
  });
  await prisma.presence.deleteMany({ where: { id } });

  // Created after the cleanup above so it isn't deleted with the rest.
  if (isSessionId(peerId) && peerId !== id) {
    await prisma.presence.updateMany({
      where: { id: peerId },
      data: { busy: false },
    });
    await prisma.signal.create({
      data: { fromId: id, toId: peerId, type: "end", payload: null },
    });
  }

  return Response.json({ ok: true });
}

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { SignalType } from "@/lib/types";
import { isSessionId, sessionFrom, unauthorized } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: SignalType[] = [
  "request",
  "accept",
  "decline",
  "offer",
  "answer",
  "ice",
  "end",
];

const MAX_PAYLOAD = 64 * 1024; // SDP/ICE are small; cap to be safe.

// POST /api/signal — body { toId, type, payload? }, Bearer session token.
// Drops one message into the recipient's mailbox, always from the token's
// owner.
//
// The server keeps each session's connection state (S2) and only delivers
// signals that fit it, so nobody can mark strangers busy or end someone
// else's chat:
//   request   caller is free and joined → caller.requestTo = target
//   accept    the target really requested the caller → both busy, peered
//   decline   the target really requested the caller → request cleared
//   end       caller is connected to, or requesting, the target → cleared
//   offer/answer/ice   only between two connected peers
// Anything else is dropped with 409.
export async function POST(request: NextRequest) {
  const fromId = sessionFrom(request);
  if (!fromId) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { toId, type, payload } = (body ?? {}) as Record<string, unknown>;

  if (!isSessionId(toId) || toId === fromId) {
    return Response.json({ error: "invalid toId" }, { status: 400 });
  }
  if (typeof type !== "string" || !VALID_TYPES.includes(type as SignalType)) {
    return Response.json({ error: "invalid type" }, { status: 400 });
  }
  if (
    payload !== undefined &&
    payload !== null &&
    (typeof payload !== "string" || payload.length > MAX_PAYLOAD)
  ) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const signalType = type as SignalType;
  const payloadStr = typeof payload === "string" ? payload : null;

  switch (signalType) {
    case "request": {
      // One active connection at a time: a busy or vanished target gets an
      // automatic decline instead of the request.
      const target = await prisma.presence.findUnique({
        where: { id: toId },
        select: { busy: true },
      });
      if (!target || target.busy) {
        await deliver(toId, fromId, "decline");
        return Response.json({ ok: true, autoDeclined: true });
      }
      const me = await prisma.presence.updateMany({
        where: { id: fromId, busy: false },
        data: { requestTo: toId },
      });
      if (me.count === 0) return rejected("you must be joined and free");
      break;
    }

    case "accept": {
      // Claim the requester's pending request to us. The conditional update
      // makes this atomic: a forged or stale accept matches no row.
      const requester = await prisma.presence.updateMany({
        where: { id: toId, requestTo: fromId, busy: false },
        data: { requestTo: null, busy: true, peerId: fromId },
      });
      if (requester.count === 0) {
        // They cancelled, timed out or left before we answered. Tell our
        // client so it stops "connecting" right away.
        await deliver(toId, fromId, "end");
        return rejected("no pending request from that session");
      }
      const me = await prisma.presence.updateMany({
        where: { id: fromId, busy: false },
        data: { requestTo: null, busy: true, peerId: toId },
      });
      if (me.count === 0) {
        // We're busy (or gone) after all: undo and decline.
        await prisma.presence.updateMany({
          where: { id: toId, peerId: fromId },
          data: { busy: false, peerId: null },
        });
        await deliver(fromId, toId, "decline");
        return rejected("you must be joined and free");
      }
      break;
    }

    case "decline": {
      const requester = await prisma.presence.updateMany({
        where: { id: toId, requestTo: fromId },
        data: { requestTo: null },
      });
      if (requester.count === 0) return rejected("no pending request from that session");
      break;
    }

    case "end": {
      const connected = await prisma.presence.updateMany({
        where: { id: fromId, peerId: toId },
        data: { busy: false, peerId: null },
      });
      if (connected.count > 0) {
        await prisma.presence.updateMany({
          where: { id: toId, peerId: fromId },
          data: { busy: false, peerId: null },
        });
        break;
      }
      // Not connected: maybe withdrawing our own request.
      const cancelled = await prisma.presence.updateMany({
        where: { id: fromId, requestTo: toId },
        data: { requestTo: null },
      });
      if (cancelled.count === 0) return rejected("not connected to that session");
      break;
    }

    case "offer":
    case "answer":
    case "ice": {
      const peered = await prisma.presence.count({
        where: { id: fromId, peerId: toId },
      });
      if (peered === 0) return rejected("not connected to that session");
      break;
    }
  }

  await deliver(fromId, toId, signalType, payloadStr);
  return Response.json({ ok: true });
}

async function deliver(
  fromId: string,
  toId: string,
  type: SignalType,
  payload: string | null = null,
) {
  await prisma.signal.create({ data: { fromId, toId, type, payload } });
}

function rejected(reason: string): Response {
  return Response.json({ error: reason }, { status: 409 });
}

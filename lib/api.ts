// Client-side helpers for talking to the coordination API.
import type { PollResponse, SignalType } from "@/lib/types";

// `id` is public (it's our dot's id). `token` is the secret that proves we
// own it: kept in memory only (not a cookie, so two tabs in one browser are
// two independent sessions) and sent as a Bearer token.
export interface Session {
  id: string;
  token: string;
}

// Thrown when the server rejects our token (e.g. the dev server restarted
// with a new secret), so the caller can start a fresh session.
export class UnauthorizedError extends Error {}

function authHeaders(token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function createSession(): Promise<Session> {
  const res = await fetch("/api/session", { method: "POST" });
  if (!res.ok) throw new Error(`session failed: ${res.status}`);
  return res.json();
}

export async function join(token: string, lat: number, lng: number): Promise<void> {
  const res = await fetch("/api/join", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ lat, lng }),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`join failed: ${res.status}`);
}

export async function poll(token: string): Promise<PollResponse> {
  const res = await fetch("/api/poll", {
    cache: "no-store",
    headers: authHeaders(token),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return res.json();
}

export async function sendSignal(
  token: string,
  toId: string,
  type: SignalType,
  payload?: string,
): Promise<void> {
  await fetch("/api/signal", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ toId, type, payload }),
  });
}

// Fire-and-forget leave that survives the tab closing. The server ends any
// connection or request we're part of from its own state. sendBeacon can't
// set headers, so the token goes in the body.
export function leave(token: string): void {
  const body = JSON.stringify({ token });
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/leave", body);
  } else {
    void fetch("/api/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  }
}

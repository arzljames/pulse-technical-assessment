# PULSE — FULL NOTES

The detailed companion to the short [NOTES.md](../NOTES.md): every finding, plus a fix log with before/after code for each fix.

Technical assessment notes for Pulse, the anonymous world-map stranger chat. Everything is grouped by category, matching the README's phases:

1. **Bugs** (Phase 1: make it run)
2. **UI/UX revamp** (Phase 2: make it good)
3. **Security revamp** (Phase 3: make it secure)
4. **New features** (Phase 4: make it better)
5. **Not fixed yet**, split into urgent (do next) and not urgent (future)

Severity: 🔴 breaks core flow or a serious hole · 🟠 real bug, edge case or meaningful risk · 🟡 minor or polish. ✅ marks fixed items, and every fix links to its own PR.

**Status at a glance**

| Category | Fixed or shipped                                       | Open                                               |
| -------- | ------------------------------------------------------ | -------------------------------------------------- |
| Bugs     | B1–B12, B16, B17, B18                                  | B13, B14, B15, B19, B20, B21                       |
| UI/UX    | Landing, chat panel, request prompts, video call       | Idea backlog (see 2.2)                             |
| Security | S1–S6, S10                                             | S7, S8, S9                                         |
| Features | Safe Reveal, stay hidden after panic, live stats panel | On-device NSFW guard, sender-side blur, TURN relay |

---

## 1. BUGS (Phase 1)

How they were found: reading every API route, `lib/` module and component end to end, tracing the request → accept → chat → video → end flow, then confirming against a running dev server.

### 1.1 Findings

#### ✅ 🔴 B1. Heartbeat refreshes _every_ user → dots never disappear — FIXED in [PR #3](https://github.com/arzljames/pulse-technical-assessment/pull/3) (see Fix log)

- `app/api/poll/route.ts:25-28` — `prisma.presence.updateMany({ where: {}, ... })` bumps `lastSeen` for **all** rows on every poll.
- While anyone is online, nobody ever goes stale, so closed tabs stay on the map. This is the README's example bug.
- **Fix:** `where: { id }`.

#### ✅ 🔴 B2. Chat messages are never received — FIXED in [PR #4](https://github.com/arzljames/pulse-technical-assessment/pull/4) (see Fix log)

- `lib/webrtc.ts:132` sends `{ t: "msg", text }`, but the receiver at `lib/webrtc.ts:79` only accepts `msg.t === "chat"`.
- The sender sees their own bubble (added locally), but the other side gets nothing.
- **Fix:** send `t: "chat"`, ideally as a shared constant or type.

#### ✅ 🔴 B3. `end` never clears `busy` → both users are stuck "busy" forever — FIXED in [PR #5](https://github.com/arzljames/pulse-technical-assessment/pull/5) (see Fix log)

- `app/api/signal/route.ts:74-84` sets `busy=true` on `accept` and clears it only on `decline`. `end` is ignored, even though the comment says "decline/end: free both peers".
- After a first chat ends, both users stay faded on the map and every later request to them is auto-declined.
- **Fix:** handle `end` the same as `decline` (`busy: false` for both ids).

#### ✅ 🔴 B4. Queued ICE candidates are flushed _before_ the remote description is set — FIXED in [PR #6](https://github.com/arzljames/pulse-technical-assessment/pull/6) (see Fix log)

- `lib/webrtc.ts:110-111` calls `flushPendingCandidates()` before `setRemoteDescription()`. With no remote description yet, `addIceCandidate` throws, and the empty `catch {}` swallows it, so those candidates are lost.
- Signals go out as separate `fetch`es, so ICE candidates can easily land in the mailbox before the offer. Losing them leads to flaky or failed connections ("connecting…" forever).
- **Fix:** call `setRemoteDescription(desc)` first, then flush.

#### ✅ 🔴 B5. Fake Mapbox fallback token hides the "missing token" state — FIXED in [PR #7](https://github.com/arzljames/pulse-technical-assessment/pull/7) (see Fix log)

- `app/components/WorldMap.tsx:8` falls back to a hard-coded fake `pk.…` token, so `!TOKEN` is never true. The "Set NEXT_PUBLIC_MAPBOX_TOKEN" hint never shows, and the map just 401s with a blank screen.
- **Fix:** drop the fallback (`process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ""`).

#### ✅ 🔴 B6. Closing the tab mid-chat doesn't end the chat for the other user — FIXED in [PR #8](https://github.com/arzljames/pulse-technical-assessment/pull/8) (see Fix log)

- The requirement says "If either user disconnects, the chat ends for both." `leave()` (`app/api/leave/route.ts:25-28`) just deletes rows. It **also deletes pending signals from the leaver**, so the peer is never told.
- The peer waits until ICE reaches `failed` (about 30 s or more). `disconnected`/`closed` and data-channel `onclose` aren't handled (`app/page.tsx:84-88`, `lib/webrtc.ts:74-86`).
- The peer's `busy` flag is never reset either, so they look busy forever (same root cause as B3).
- **Fix:** on leave, look up the active peer, clear their `busy`, and drop an `end` signal for them. On the client, treat `dc.onclose` / `connectionState === "disconnected" | "closed"` as hang-up (with a short grace period for `disconnected`).

#### ✅ 🟠 B7. Users silently vanish and never come back — FIXED in [PR #9](https://github.com/arzljames/pulse-technical-assessment/pull/9) (see Fix log)

- Poll only `update`s presence and never re-creates it. Several cases leave the user invisible to others while their own map still works:
  - **Background tabs:** browsers throttle timers to about once a minute, which is more than `STALE_MS = 15 s`, so the row gets reaped.
  - **bfcache:** `pagehide` fires and `leave()` deletes the row, then the user navigates back.
  - **Failed join:** `join()` (`lib/api.ts:9`) doesn't check `res.ok`, so the user enters "live" with no row.
- **Fix:** poll should return a "not joined" flag (or 410) so the client re-joins, or the heartbeat should be an upsert. Only call `leave` on `pagehide` when `!e.persisted`. Check `res.ok` in `join`.

#### ✅ 🟠 B8. Auto-declining while busy marks the busy user as free — FIXED in [PR #10](https://github.com/arzljames/pulse-technical-assessment/pull/10) (see Fix log)

- When a request reaches someone who isn't idle, the client sends `decline` (`app/page.tsx:217`). The server's `decline` handler sets `busy=false` for **both** ids (`signal/route.ts:79-83`), so a user who is mid-chat now shows as available.
- **Fix:** only clear `busy` for a real decline of a pending request, or have the server track the pair. Use a distinct type like `busy` for auto-declines.

#### ✅ 🟠 B9. Cancel and accept race leaves the target stuck in "connecting" and busy — FIXED in [PR #11](https://github.com/arzljames/pulse-technical-assessment/pull/11) (see Fix log)

- If the initiator cancels (or times out) just as the target accepts, the initiator is already `idle` and ignores `accept`. Meanwhile the server has marked both users busy.
- The target sits on "Connecting…" forever, because there's no timeout for the `connecting` state.
- **Fix:** add a connecting timeout (around 20 s) that tears down and sends `end`. When an initiator gets an `accept` it doesn't expect, it should reply `end`.

#### ✅ 🟠 B10. `handleSignal` has no error handling — FIXED in [PR #12](https://github.com/arzljames/pulse-technical-assessment/pull/12) (see Fix log)

- `lib/webrtc.ts:88-118`: `JSON.parse`, `setRemoteDescription`, and `setLocalDescription` can throw. They're called with `void` (`app/page.tsx:245`), so failures become unhandled rejections and the call silently stalls.
- `onnegotiationneeded` has `try/finally` but no `catch`.

#### ✅ 🟠 B11. Peer marker positions never update — FIXED in [PR #13](https://github.com/arzljames/pulse-technical-assessment/pull/13) (see Fix log)

- `WorldMap.tsx:125-138` calls `setLngLat` only when a marker is created. A peer who re-joins (new offset) keeps their old position.
- **Fix:** call `marker.setLngLat` on every reconcile.

#### ✅ 🟠 B12. Busy peers are still clickable — FIXED in [PR #14](https://github.com/arzljames/pulse-technical-assessment/pull/14) (see Fix log)

- They're only faded (`WorldMap.tsx:139`). Clicking one sends a request that is instantly auto-declined, showing "Request declined", which is confusing.
- **Fix:** disable the click and show a "busy" tooltip.

#### 🟡 B13. Overlapping notices clear each other early

- `showNotice` (`app/page.tsx:55-58`) starts a new timeout each time without clearing the old one, so an earlier timer can hide a newer notice.

#### 🟡 B14. `requestTimer` isn't nulled after it's cleared

- In `teardown`/`accept`/`decline`, the timer is cleared but the ref isn't nulled. This is harmless today but brittle.

#### 🟡 B15. Transceivers pile up across video calls

- `stopVideo` uses `removeTrack`, which leaves inactive transceivers. Each new video call adds more, and the SDP keeps growing.
- **Fix:** reuse transceivers with `sender.replaceTrack`, or use `transceiver.stop()`.

#### ✅ 🟡 B16. Chat is hidden while video is on — FIXED in [PR #19](https://github.com/arzljames/pulse-technical-assessment/pull/19) (video call redesign)

- `VideoPanel` is a full-screen `z-30` overlay, so chat is unreachable during a call. There are also no mute or camera-off toggles.

#### ✅ 🟡 B17. The online count excludes yourself and includes busy users — ADDRESSED in [PR #22](https://github.com/arzljames/pulse-technical-assessment/pull/22) ("N online worldwide" counts you; the stats panel splits in a chat / available)

- "N online" is ambiguous. Consider "N others online · M available".

#### ✅ 🟡 B18. Geist font is overridden — FIXED in [PR #15](https://github.com/arzljames/pulse-technical-assessment/pull/15) (part of the landing redesign)

- `globals.css:25` sets `font-family: Arial`, which overrides the Geist font set up in `layout.tsx`.

#### 🟡 B19. Some APIs need a secure context

- `crypto.randomUUID()`, geolocation, and `getUserMedia` all require HTTPS or localhost. Testing on a LAN IP over http fails with no clear error.
- `crypto.randomUUID` also runs during SSR in the `useState` initializer, which works but is wasted.

#### 🟡 B20. Leftover dev config

- `next.config.ts:5` has a hard-coded ngrok host in `allowedDevOrigins`.

#### 🟡 B21. Setup docs mismatch

- The README says `prisma db push`, but the repo ships migrations. Use `prisma migrate deploy` for Vercel, and/or add `postinstall: prisma generate`.

### 1.2 Fix log

#### B1 — Heartbeat only the calling session

**PR:** [#3](https://github.com/arzljames/pulse-technical-assessment/pull/3)

**File:** `app/api/poll/route.ts`

**Problem:** The heartbeat step of `/api/poll` ran `updateMany` with an empty `where`, so every poll from _any_ user refreshed `lastSeen` on _every_ presence row. While at least one person was online, no row could ever become older than `STALE_MS`, so the stale reaper never removed anything. Closed tabs stayed on the map indefinitely.

**How found:** The README's example symptom ("dots stayed on the map for ages") pointed at the stale-presence path. The reaper logic (`deleteMany where lastSeen < staleCutoff`) was correct, so the bug had to be in what keeps `lastSeen` fresh.

**Fix:** Scope the heartbeat to the caller's own row.

**Before:**

```ts
// 1) Heartbeat — refresh lastSeen for the caller.
await prisma.presence.updateMany({
  where: {},
  data: { lastSeen: new Date(now) },
});
```

**After:**

```ts
// 1) Heartbeat — refresh lastSeen for the caller.
await prisma.presence.updateMany({
  where: { id },
  data: { lastSeen: new Date(now) },
});
```

**Result:** A user who closes their tab without a clean `leave` (crash, killed browser, lost network) now disappears from everyone's map within `STALE_MS` (15 s), on the next poll from any other user.

#### B2 — Chat message tag mismatch

**PR:** [#4](https://github.com/arzljames/pulse-technical-assessment/pull/4)

**File:** `lib/webrtc.ts`

**Problem:** Chat travels over the WebRTC data channel as JSON tagged with a `t` field. The sender tagged messages `t: "msg"`, but the receiver only handled `t: "chat"` (and `t: "ctrl"`). Every incoming chat message fell through both branches and was silently dropped. The sender still saw their own bubble (it's added locally), so it _looked_ like chat worked from one side.

**How found:** Traced the chat path end to end: `ChatPanel.onSend` → `PeerSession.sendChat` → `dc.send`, then `dc.onmessage` → `cb.onChat`. The two string literals didn't match.

**Fix:** Send the tag the receiver expects.

**Before:**

```ts
sendChat(text: string) {
  this.safeSend({ t: "msg", text });
}
```

**After:**

```ts
sendChat(text: string) {
  this.safeSend({ t: "chat", text });
}
```

**Result:** Messages typed by either user now appear in the other user's chat panel in real time.

#### B3 — `end` frees both peers

**PR:** [#5](https://github.com/arzljames/pulse-technical-assessment/pull/5)

**File:** `app/api/signal/route.ts`

**Problem:** The server keeps a `busy` flag so a user can only be in one connection at a time. `accept` set `busy=true` on both peers, but only `decline` set it back to `false`. Hanging up sends `end`, which was ignored by the busy logic even though the comment said "decline/end: free both peers". After their first chat, both users stayed `busy` forever: their dots stayed faded, and every new request to them was auto-declined server-side ("Request declined.").

**How found:** Compared the comment above the busy transitions against the branches below it; `end` was documented but not handled. Then walked the hang-up path (`endConnection` → `sendSignal(..., "end")`) to confirm nothing else clears `busy`.

**Fix:** Treat `end` like `decline` for busy transitions.

**Before:**

```ts
} else if (signalType === "decline") {
  await prisma.presence.updateMany({
    where: { id: { in: [fromId, toId] } },
    data: { busy: false },
  });
}
```

**After:**

```ts
} else if (signalType === "decline" || signalType === "end") {
  await prisma.presence.updateMany({
    where: { id: { in: [fromId, toId] } },
    data: { busy: false },
  });
}
```

**Result:** After either user presses End, both dots return to full opacity and both users can be requested again.

**Known limitation:** `busy` is still cleared by trusting the client's `fromId`/`toId` pair, so a stray or forged `end`/`decline` can free a user who is mid-chat (B8, S2). The real fix is server-side tracking of who is connected to whom. That's planned with the security work.

#### B4 — Flush queued ICE candidates after the remote description

**PR:** [#6](https://github.com/arzljames/pulse-technical-assessment/pull/6)

**File:** `lib/webrtc.ts`

**Problem:** Each signal is its own HTTP request, so ICE candidates can reach the mailbox before the SDP offer/answer they belong to. `handleSignal` correctly queues candidates that arrive while `remoteDescription` is null, but then flushed that queue _before_ calling `setRemoteDescription`. At that moment there is still no remote description, so every `addIceCandidate` throws `InvalidStateError`, and the empty `catch {}` swallowed it. The early candidates (often the host and server-reflexive ones that matter most) were silently discarded. Connections then failed or stuck on "Connecting…", depending on timing.

**How found:** Read the candidate queueing logic: the queue exists exactly because candidates can't be added without a remote description, yet it was drained one line before the remote description was set.

**Fix:** Set the remote description first, then flush the queue.

**Before:**

```ts
await this.flushPendingCandidates();
await this.pc.setRemoteDescription(desc);
if (desc.type === "offer") {
```

**After:**

```ts
await this.pc.setRemoteDescription(desc);
// Candidates can only be applied once a remote description exists.
await this.flushPendingCandidates();
if (desc.type === "offer") {
```

**Result:** Candidates that arrive early are now applied instead of dropped, so the peer connection reliably reaches `connected` and the chat panel moves from "Connecting…" to "Connected".

#### B5 — Remove the fake Mapbox fallback token

**PR:** [#7](https://github.com/arzljames/pulse-technical-assessment/pull/7)

**File:** `app/components/WorldMap.tsx`

**Problem:** `TOKEN` fell back to a hard-coded, invalid `pk.…` string when `NEXT_PUBLIC_MAPBOX_TOKEN` was unset. The component already has a "missing token" path: it skips map init and shows "Set NEXT_PUBLIC_MAPBOX_TOKEN in .env to load the map". But that path checks `!TOKEN`, which the fake string made permanently false. A missing env var produced a blank map and 401 errors in the console instead of the helpful message.

**How found:** Followed the `!TOKEN` guards in `WorldMap` (map init and the hint overlay) back to the constant and saw that it could never be empty.

**Fix:** Fall back to an empty string so the existing guard works.

**Before:**

```ts
const TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN ??
  "pk.eyJ1IjoicHVsc2UtbWFwIiwiYSI6ImNrMDBkZW1vMDAwMDAwMDAifQ.AAAAAAAAAAAAAAAAAAAAAA";
```

**After:**

```ts
const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
```

**Result:** With no token configured, the app shows the setup hint instead of a silent blank map. With a real token, behaviour is unchanged.

**Note:** The `.env.example` placeholder (`pk.your_mapbox_token_here`) is non-empty, so copying the example without editing it still shows a blank map. Mapbox rejects it at runtime.

#### B6 — Leaving ends the connection for the other user

**PR:** [#8](https://github.com/arzljames/pulse-technical-assessment/pull/8)

**Files:** `app/api/leave/route.ts`, `lib/api.ts`, `lib/webrtc.ts`, `app/page.tsx`

**Problem:** The requirement says "If either user disconnects, the chat ends for both." Closing the tab only sent a `leave` beacon, which deleted the leaver's presence row **and every pending signal from them**. Nothing ever told the other user. Their chat panel stayed open on "Connected" until ICE eventually reported `failed`, which can take 30 s or more. The client only listened for `failed` and ignored the data channel closing. The remaining user's `busy` flag was also never cleared, so they looked busy and got auto-declined forever. The same thing happened before the chat opened: a requester closing their tab left the target staring at an "A stranger wants to connect" prompt that could never succeed.

**How found:** Traced what happens on tab close: `pagehide` → `leave()` → `/api/leave`. The route only deletes, and the client's `PeerSession` had no `onclose` handler on the data channel.

**Fix:** Two independent paths, so the other user is notified whether or not the leaver gets a clean exit:

1. **Clean close (beacon arrives):** `leave()` now also sends the current `peerId` (in any non-idle state: requesting, incoming, connecting, connected). After its cleanup deletes, `/api/leave` clears the peer's `busy` flag and drops an `end` signal in their mailbox. It's created _after_ the deletes so it isn't wiped with the leaver's other signals.
2. **Crash / network drop (no beacon):** `PeerSession` now reports `dc.onclose` through a new `onChannelClose` callback, but only for closes we didn't cause ourselves. The remaining client tears down with "Stranger disconnected." and sends `end`, so the server clears its `busy` flag (via the B3 fix). The `failed` connection state now also sends `end` for the same reason.
3. The client `end` handler now also handles the `requesting` state ("Stranger left."). Before, a requester whose target closed the tab waited out the full 30 s timeout.

**Before:**

```ts
// lib/api.ts
export function leave(id: string): void {
  const body = JSON.stringify({ id });

// app/api/leave/route.ts
await prisma.signal.deleteMany({ where: { OR: [{ toId: id }, { fromId: id }] } });
await prisma.presence.deleteMany({ where: { id } });
return Response.json({ ok: true });

// lib/webrtc.ts — no close handling
dc.onopen = () => this.cb.onChannelOpen();
dc.onmessage = ...

// app/page.tsx
const onLeave = () => leave(sessionId);
...
onConnectionState: (state) => {
  if (state === "failed") teardown("Connection failed (network).");
},
...
if ((c.kind === "incoming" || c.kind === "connecting" || c.kind === "connected") && c.peerId === sig.fromId) {
  if (c.kind === "incoming") setConn({ kind: "idle" });
  else teardown("Stranger disconnected.");
}
```

**After:**

```ts
// lib/api.ts
export function leave(id: string, peerId?: string): void {
  const body = JSON.stringify({ id, peerId });

// app/api/leave/route.ts
await prisma.signal.deleteMany({ where: { OR: [{ toId: id }, { fromId: id }] } });
await prisma.presence.deleteMany({ where: { id } });
// Created after the cleanup above so it isn't deleted with the rest.
if (typeof peerId === "string" && peerId && peerId !== id) {
  await prisma.presence.updateMany({ where: { id: peerId }, data: { busy: false } });
  await prisma.signal.create({ data: { fromId: id, toId: peerId, type: "end", payload: null } });
}

// lib/webrtc.ts
dc.onopen = () => this.cb.onChannelOpen();
// Only report closes we didn't cause ourselves via close().
dc.onclose = () => {
  if (!this.closed) this.cb.onChannelClose();
};

// app/page.tsx
const onLeave = () => {
  const c = connRef.current;
  leave(sessionId, c.kind === "idle" ? undefined : c.peerId);
};
...
onConnectionState: (state) => {
  if (state === "failed") {
    void sendSignal(sessionId, peerId, "end");
    teardown("Connection failed (network).");
  }
},
onChannelClose: () => {
  void sendSignal(sessionId, peerId, "end");
  teardown("Stranger disconnected.");
},
...
if (c.kind !== "idle" && c.peerId === sig.fromId) {
  if (c.kind === "incoming") setConn({ kind: "idle" });
  else if (c.kind === "requesting") teardown("Stranger left.");
  else teardown("Stranger disconnected.");
}
```

**Result:**

- When a user closes their tab mid-chat, the other user's chat closes with "Stranger disconnected." within about a second (data channel close) or one poll (the `end` signal), and they're immediately available again.
- If the leaver crashes with no beacon, the data channel close still ends the chat and frees the remaining user.
- A pending request or incoming prompt is cancelled when either side leaves.

**Known limitations:**

- When a user presses End normally, the other side may see the data channel close before the `end` signal arrives and send a redundant `end` back. That's harmless: the server just clears `busy` again, and the sender, now idle, ignores it.
- `peerId` in the leave body is client-supplied, like every id today (S1/S2).
- A crash during the `connecting` phase (no data channel yet) still relies on ICE `failed` or the B9 timeout.

#### B7 — Re-join when the presence row is missing

**PR:** [#9](https://github.com/arzljames/pulse-technical-assessment/pull/9)

**Files:** `app/api/poll/route.ts`, `app/page.tsx`, `lib/api.ts`, `lib/types.ts`

**Problem:** `/api/poll` only _updates_ the caller's presence row and never creates one. Once the row was gone, the user was invisible to everyone else for the rest of the session, while their own map still showed everybody. Nothing told them anything was wrong. The row could disappear in three ways:

- **Throttled background tabs:** browsers slow timers in hidden or fully covered windows. Chrome's intensive throttling drops them to about once a minute. Polls stop for longer than `STALE_MS` (15 s) and another user's poll reaps the row. The README's own two-window test setup can trigger this.
- **bfcache:** `pagehide` always sent `leave`, even when the page was only going into the back/forward cache. Pressing Back restored a live-looking page with no row.
- **Failed initial join:** `join()` never checked `res.ok`, so a 4xx/5xx was treated as success.

**How found:** Asked "what recreates a presence row after `/api/join`?" The answer was nothing. Then listed every path that deletes one: the reaper, `leave`, and a join that never happened.

**Fix:**

1. The heartbeat's `updateMany` already returns how many rows it touched. Poll now returns `joined: false` when that count is 0, at no extra query cost.
2. The client keeps the raw location in a ref (client-side only) and re-joins whenever a poll says `joined: false`.
3. `pagehide` skips `leave` when `e.persisted` is true (entering bfcache). The redundant `beforeunload` listener is removed, since `pagehide` already covers close, reload and navigation, and `beforeunload` can make the page ineligible for bfcache.
4. `join()` throws on non-2xx. A failed initial join is no longer fatal, because the first poll sees `joined: false` and retries.

**Before:**

```ts
// app/api/poll/route.ts
await prisma.presence.updateMany({ where: { id }, data: { lastSeen: new Date(now) } });
...
const response: PollResponse = {
  peers: ...,

// lib/api.ts
await fetch("/api/join", { ... });          // status ignored

// app/page.tsx
const data = await poll(sessionId);
if (!active) return;
setPeers(data.peers);
...
const onLeave = () => { ... leave(sessionId, ...); };
window.addEventListener("pagehide", onLeave);
window.addEventListener("beforeunload", onLeave);
...
async function handleReady(lat: number, lng: number) {
  setMyLocation({ lat, lng });
  await join(sessionId, lat, lng);
  setPhase("live");
}
```

**After:**

```ts
// app/api/poll/route.ts
const heartbeat = await prisma.presence.updateMany({ where: { id }, data: { lastSeen: new Date(now) } });
...
const response: PollResponse = {
  joined: heartbeat.count > 0,
  peers: ...,

// lib/api.ts
const res = await fetch("/api/join", { ... });
if (!res.ok) throw new Error(`join failed: ${res.status}`);

// app/page.tsx
const data = await poll(sessionId);
if (!active) return;
if (!data.joined && locationRef.current) {
  const { lat, lng } = locationRef.current;
  await join(sessionId, lat, lng);
}
setPeers(data.peers);
...
const onLeave = (e: PageTransitionEvent) => {
  if (e.persisted) return;   // entering bfcache, not unloading
  ...
  leave(sessionId, ...);
};
window.addEventListener("pagehide", onLeave);
...
async function handleReady(lat: number, lng: number) {
  setMyLocation({ lat, lng });
  locationRef.current = { lat, lng };
  try {
    await join(sessionId, lat, lng);
  } catch {
    // Not fatal: the first poll reports joined=false and retries the join.
  }
  setPhase("live");
}
```

**Result:** A tab that was backgrounded, throttled, restored from bfcache, or whose first join failed reappears on everyone's map on its next poll after it wakes up (about 1.5 s), with no reload needed.

**Known limitations:**

- A re-join applies a fresh 1–3 km offset, so the dot moves slightly. Repeated re-joins also feed the averaging concern in S4.
- The re-created row has `busy=false`. If the user was mid-chat when reaped, they briefly look available. Requests to them are still declined client-side because they aren't idle, but that path hits B8. It's solved properly by server-side connection state (S2).

#### B8 — Decline no longer clears `busy`

**PR:** [#10](https://github.com/arzljames/pulse-technical-assessment/pull/10)

**File:** `app/api/signal/route.ts`

**Problem:** The server checks `busy` before delivering a request, but there's a race. If a request arrives just as the target is accepting someone else, it slips through. The client then auto-replies `decline` because it isn't idle. The server's `decline` handler set `busy=false` on **both** `fromId` and `toId`, so the user who was still mid-chat suddenly looked available. Their dot returned to full opacity and new requests reached them again.

**How found:** Walked every place that sends `decline` and asked who could be busy at that moment:

- **Manual decline** (`declineIncoming`): decliner is in the `incoming` state, not busy. Requester is in `requesting`, not busy.
- **Server auto-decline** (`sendDecline` helper): writes the signal directly and doesn't go through the busy logic.
- **Client auto-decline** (`processSignal` → `request` while not idle): the decliner may well be **busy**.

Requests never set `busy`, so the clearing never helped a genuine decline. It only ever fired in the one case where it was harmful.

**Fix:** Take `decline` out of the busy transitions. Only `accept` (sets) and `end` (clears) change `busy`. This was originally planned as a new `busy` signal type, but that turned out to be unnecessary.

**Before:**

```ts
// Busy transitions:
// - accept: the connection is now active → mark BOTH peers busy.
// - decline/end: free both peers.
if (signalType === "accept") {
  await prisma.presence.updateMany({
    where: { id: { in: [fromId, toId] } },
    data: { busy: true },
  });
} else if (signalType === "decline" || signalType === "end") {
  await prisma.presence.updateMany({
    where: { id: { in: [fromId, toId] } },
    data: { busy: false },
  });
}
```

**After:**

```ts
// Busy transitions:
// - accept: the connection is now active → mark BOTH peers busy.
// - end: the connection is over → free both peers.
// - decline: no change. It only ever answers a request, and requests don't
//   set busy, so a genuine decline has nobody to free. The one time the
//   decliner IS busy is an auto-decline from someone mid-chat — clearing it
//   there would make them look available while they're still connected.
if (signalType === "accept") {
  await prisma.presence.updateMany({
    where: { id: { in: [fromId, toId] } },
    data: { busy: true },
  });
} else if (signalType === "end") {
  await prisma.presence.updateMany({
    where: { id: { in: [fromId, toId] } },
    data: { busy: false },
  });
}
```

**Result:** A user in an active chat stays marked busy (faded, auto-declined server-side) for the whole connection, even if a request races past the server's check. Genuine declines behave exactly as before.

**Known limitation:** `end` still trusts the client's `fromId`/`toId` pair. A stray or forged `end` from someone who isn't the current peer can free a busy user. Fixing that needs the server to track who is connected to whom (S2).

#### B9 — Connecting timeout and stale-accept rejection

**PR:** [#11](https://github.com/arzljames/pulse-technical-assessment/pull/11)

**File:** `app/page.tsx`

**Problem:** If the initiator cancels (or hits the 30 s request timeout) at the same moment the target presses Accept, the two messages cross. The initiator is already `idle`, so the `accept` handler's `requesting` check fails and the accept is silently dropped. Meanwhile the target has created its `PeerSession` and moved to `connecting`, and the server has marked **both** users busy. Nothing ever moved the target out of `connecting`: the state had no timeout. The target sat on "Connecting…" until they pressed End, and any stalled handshake (peer vanished, ICE never finishing) got stuck the same way.

**How found:** Checked every state in the `Conn` machine for an exit path. `requesting` has a 30 s timer, `incoming` ends on `end` or a user action, `connected` ends on `end` or channel close. `connecting` relied entirely on the data channel opening.

**Fix:**

1. **Connecting timeout on both sides:** `startConnectTimeout(peerId)` starts when the target accepts and when the initiator receives the accept. If still `connecting` to that peer after `CONNECT_TIMEOUT_MS` (20 s), it sends `end` (freeing busy server-side via B3) and tears down with "Couldn't connect." The timer is cleared in `onChannelOpen` and in `teardown`.
2. **Reject stale accepts:** if the initiator receives an `accept` from someone it isn't engaged with, it replies `end`. The target is released on its next poll instead of waiting for the timeout.

**Before:**

```ts
function acceptIncoming() {
  ...
  startPeer(peerId, false);
  void sendSignal(sessionId, peerId, "accept");
  setConn({ kind: "connecting", peerId });
}
...
onChannelOpen: () => {
  setConn({ kind: "connected", peerId });
},
...
case "accept": {
  const c = connRef.current;
  if (c.kind === "requesting" && c.peerId === sig.fromId) {
    if (requestTimer.current) clearTimeout(requestTimer.current);
    startPeer(sig.fromId, true);
    setConn({ kind: "connecting", peerId: sig.fromId });
  }
  break;
}
```

**After:**

```ts
const CONNECT_TIMEOUT_MS = 20_000;
...
function startConnectTimeout(peerId: string) {
  if (connectTimer.current) clearTimeout(connectTimer.current);
  connectTimer.current = setTimeout(() => {
    const c = connRef.current;
    if (c.kind === "connecting" && c.peerId === peerId) {
      void sendSignal(sessionId, peerId, "end");
      teardown("Couldn't connect.");
    }
  }, CONNECT_TIMEOUT_MS);
}
...
function acceptIncoming() {
  ...
  setConn({ kind: "connecting", peerId });
  startConnectTimeout(peerId);
}
...
onChannelOpen: () => {
  if (connectTimer.current) clearTimeout(connectTimer.current);
  setConn({ kind: "connected", peerId });
},
...
case "accept": {
  const c = connRef.current;
  if (c.kind === "requesting" && c.peerId === sig.fromId) {
    ...
    setConn({ kind: "connecting", peerId: sig.fromId });
    startConnectTimeout(sig.fromId);
  } else if (c.kind === "idle" || c.peerId !== sig.fromId) {
    // An accept we're no longer waiting for — tell them.
    void sendSignal(sessionId, sig.fromId, "end");
  }
  break;
}
```

(`teardown` also clears `connectTimer`.)

**Result:**

- In the cancel/accept race, the target is returned to the map within one poll (about 1.5 s), and both users' busy flags are cleared.
- Any other stalled handshake gives up cleanly after 20 s on both sides instead of hanging forever.

**Known limitation:** `end` clears busy for both ids. If the initiator has already connected to someone else by the time the stale accept arrives, its reply `end` also frees its own busy flag. That needs server-side pair tracking (S2).

#### B10 — Handle negotiation errors instead of swallowing them

**PR:** [#12](https://github.com/arzljames/pulse-technical-assessment/pull/12)

**Files:** `lib/webrtc.ts`, `app/page.tsx`

**Problem:** `PeerSession.handleSignal` could throw in several places: `JSON.parse` on a malformed payload, `setRemoteDescription` rejecting an SDP, or `setLocalDescription` failing to create an answer. `page.tsx` called it as `void peerRef.current.handleSignal(...)`, so every failure became an unhandled promise rejection. The connection just stopped progressing, with no message and no cleanup. `addIceCandidate` errors went into empty `catch {}` blocks, and `onnegotiationneeded` had `try/finally` with no `catch`, so a failed offer was another unhandled rejection.

**How found:** Searched for empty `catch {}` blocks and `void`-ed promises in the signaling path. Every async WebRTC call either had its error swallowed or never caught.

**Fix:** Classify errors by severity instead of treating them all the same:

| Error                                                | Severity                                  | Handling                                                                              |
| ---------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| Malformed signal payload                             | Recoverable                               | `console.warn`, drop the message                                                      |
| One ICE candidate fails to add                       | Recoverable (ICE can succeed with others) | `console.warn`; silent if it belongs to an offer we deliberately ignored during glare |
| `setRemoteDescription` / `setLocalDescription` fails | Fatal for this negotiation                | new `onError` callback                                                                |
| `onnegotiationneeded` fails                          | Fatal for this negotiation                | `onError`                                                                             |

`handleSignal` now never rejects. The page's `onError` handler decides what happens based on state:

- **Connecting:** send `end` and tear down with "Couldn't connect." straight away (no 20 s wait for the B9 timeout).
- **Connected with video:** a video renegotiation failed, but the data channel is fine. End video only, keep the chat, and show "Video couldn't start."

**Before:**

```ts
// lib/webrtc.ts
this.pc.onnegotiationneeded = async () => {
  try {
    this.makingOffer = true;
    await this.pc.setLocalDescription();
    ...
  } finally {
    this.makingOffer = false;
  }
};

async handleSignal(type: DescType, payload: string) {
  if (this.closed) return;
  const data = JSON.parse(payload);                // can throw
  if (type === "ice") {
    ...
    try { await this.pc.addIceCandidate(data); } catch {}
    return;
  }
  ...
  await this.pc.setRemoteDescription(desc);        // can throw
  await this.flushPendingCandidates();             // empty catches inside
  if (desc.type === "offer") {
    await this.pc.setLocalDescription();           // can throw
    ...
  }
}
```

**After:**

```ts
// lib/webrtc.ts
this.pc.onnegotiationneeded = async () => {
  try { ... }
  catch (err) { if (!this.closed) this.cb.onError(err); }
  finally { this.makingOffer = false; }
};

// Never rejects: malformed payloads and individual ICE failures are logged
// and dropped (recoverable); SDP failures are reported via onError.
async handleSignal(type: DescType, payload: string) {
  if (this.closed) return;
  let data: unknown;
  try { data = JSON.parse(payload); }
  catch { console.warn(`[webrtc] dropping malformed ${type} payload`); return; }

  if (type === "ice") { ...; await this.addCandidate(data as RTCIceCandidateInit); return; }

  try {
    ...
    await this.pc.setRemoteDescription(desc);
    await this.flushPendingCandidates();
    if (desc.type === "offer") { await this.pc.setLocalDescription(); ... }
  } catch (err) {
    if (!this.closed) this.cb.onError(err);
  }
}

private async addCandidate(candidate: RTCIceCandidateInit) {
  try { await this.pc.addIceCandidate(candidate); }
  catch (err) {
    if (!this.ignoreOffer && !this.closed) console.warn("[webrtc] failed to add ICE candidate", err);
  }
}

// app/page.tsx
onError: (err) => {
  console.error("[webrtc] negotiation failed", err);
  if (connRef.current.kind === "connecting") {
    void sendSignal(sessionId, peerId, "end");
    teardown("Couldn't connect.");
  } else if (videoRef.current !== "none") {
    endVideo();
    showNotice("Video couldn't start.");
  }
},
```

**Result:**

- No more unhandled rejections from the signaling path.
- A failed handshake ends promptly with "Couldn't connect." and frees both users.
- A failed video renegotiation falls back to text chat instead of leaving a broken video panel.
- Recoverable problems are logged with a `[webrtc]` prefix for debugging but don't interrupt the user.

#### B11 — Move peer markers when their position changes

**PR:** [#13](https://github.com/arzljames/pulse-technical-assessment/pull/13)

**File:** `app/components/WorldMap.tsx`

**Problem:** The marker reconcile loop called `setLngLat` only when a marker was first created. Since B7, a peer whose presence row was reaped re-joins automatically with a **fresh** 1–3 km offset, but their marker stayed at the old coordinates on everyone else's map. The app was showing a position the server no longer had.

**How found:** Checked what the reconcile loop updates for an _existing_ marker: only `opacity`. B7 made position changes a normal occurrence, so this went from theoretical to visible.

**Fix:** For existing markers, compare the current position with the server's, and call `setLngLat` only when it differs. The loop runs on every 1.5 s poll, so unchanged markers aren't touched.

**Before:**

```ts
if (!marker) {
  ...
  marker = new mapboxgl.Marker({ element: el }).setLngLat([peer.lng, peer.lat]).addTo(map);
  markers.set(peer.id, marker);
}
marker.getElement().style.opacity = peer.busy ? "0.35" : "1";
```

**After:**

```ts
if (!marker) {
  ...
  marker = new mapboxgl.Marker({ element: el }).setLngLat([peer.lng, peer.lat]).addTo(map);
  markers.set(peer.id, marker);
} else {
  // A peer that re-joined (new privacy offset) moves; skip the update
  // when nothing changed, since this runs on every poll.
  const pos = marker.getLngLat();
  if (pos.lng !== peer.lng || pos.lat !== peer.lat) {
    marker.setLngLat([peer.lng, peer.lat]);
  }
}
marker.getElement().style.opacity = peer.busy ? "0.35" : "1";
```

**Result:** Dots always reflect the current server position. A re-joined peer's dot moves to its new spot on the next poll, without a duplicate marker.

#### B12 — Make busy dots non-interactive

**PR:** [#14](https://github.com/arzljames/pulse-technical-assessment/pull/14)

**Files:** `app/components/WorldMap.tsx`, `app/globals.css`

**Problem:** Busy peers (already in a conversation) were only faded to 35% opacity. They still pulsed, scaled up on hover, said "Tap to connect", and clicking one sent a real request. The server immediately auto-declined it (target is busy), and the user saw "Request declined." That reads as the stranger personally rejecting you, when they never even saw the request. It also cost a pointless round trip.

**How found:** The click handler only checked `canConnectRef` (whether _I_ am idle), never whether the _target_ was busy. The busy flag was used purely for opacity.

**Fix:**

- On each reconcile, write the busy state to the dot as `aria-disabled`. The click listener is bound once at creation and would otherwise capture a stale `peer` object, so it reads the attribute to get the current value and returns early when busy.
- Switch `title` and `aria-label` between "Tap to connect" and "In a conversation", so screen readers announce it too.
- CSS for `[aria-disabled="true"]`: `not-allowed` cursor, no pulse animation, no hover scale.

**Before:**

```ts
el.title = "Tap to connect";
el.addEventListener("click", (e) => {
  e.stopPropagation();
  if (canConnectRef.current) onPeerClickRef.current(peer.id);
});
...
marker.getElement().style.opacity = peer.busy ? "0.35" : "1";
```

**After:**

```ts
el.addEventListener("click", (e) => {
  e.stopPropagation();
  // Busy peers would just auto-decline — don't send the request.
  if (el.getAttribute("aria-disabled") === "true") return;
  if (canConnectRef.current) onPeerClickRef.current(peer.id);
});
...
const el = marker.getElement();
el.style.opacity = peer.busy ? "0.35" : "1";
el.setAttribute("aria-disabled", String(peer.busy));
el.title = peer.busy ? "In a conversation" : "Tap to connect";
el.setAttribute("aria-label", peer.busy ? "Stranger, in a conversation" : "Stranger, tap to connect");
```

```css
.pulse-dot[aria-disabled="true"] {
  cursor: not-allowed;
  animation: none;
}
.pulse-dot[aria-disabled="true"]:hover {
  transform: none;
}
```

**Result:** Busy dots look and behave unavailable: faded, still, a not-allowed cursor, and an "In a conversation" tooltip. Clicking does nothing, so there's no misleading "Request declined." They become clickable again on the next poll after the conversation ends.

---

## 2. UI/UX REVAMP (Phase 2)

Built screen by screen to designs provided for each one. Each screen has its own PR.

### 2.1 What shipped

#### 1. Landing page — ✅ [PR #15](https://github.com/arzljames/pulse-technical-assessment/pull/15)

**Files:** `app/components/DotGlobe.tsx` (new), `app/components/EntryGate.tsx`, `app/globals.css`

**Before:** a plain centered stack on flat zinc-950: "Pulse" heading, one-line tagline, an emerald "Enter Pulse" button, and a grey privacy footnote. No visual identity or motion, and the body font was Arial (B18).

**After:**

- **Dot-matrix globe hero** (`DotGlobe`): a canvas sphere of 1,600 evenly spaced points (Fibonacci lattice), orthographically projected and slowly spinning. The crown rises to mid-viewport with the limb visible on both sides. Ten periwinkle/ember "people" markers sit at latitudes that face the viewer, each with an expanding pulse ring at offset phases so they don't beat in unison.
- **Copy and layout per design:** "● Pulse" wordmark and `PEER-TO-PEER · WEBRTC` tag, a live-status pill with a blinking green dot, the oversized 3-line headline "Find someone out there." (tight leading and tracking), subtitle, a periwinkle **Enter Pulse** pill with a dark arrow badge, three privacy chips with icons, and the mono footer "Close the tab and everything ends."
- **Design tokens:** `ink #06070b`, `surface #0e1017`, `line #1d2030`, `accent #8fa2ff`, `ember #f59e6b`, `live #34d399`. The app is now dark-only, and Geist replaces Arial.
- **Micro-interactions:** staggered rise-in entrance, CTA glow and hover, arrow nudge on hover, spinner and "Locating you…" while geolocating, and an inline error announced via `aria-live`.

**Why these choices:**

- A canvas globe instead of Mapbox on the landing page: it's instant (no tiles, no token needed to see the hero), costs a few kB, and sets up the "living globe" idea before the real map loads.
- Gentle limb fade instead of a strong one: an early version faded the edges too hard and the sphere disappeared. Keeping the outline visible is what makes it read as a globe.
- Removed a dark radial vignette behind the headline after testing. It caused visible gradient banding, and the globe's crown already sits below the headline.

**Accessibility and responsiveness:**

- `prefers-reduced-motion`: the globe renders a single static frame, drawn synchronously, and the rise and blink animations are off.
- The globe is `aria-hidden`, and the CTA has a visible focus ring.
- On narrow screens the globe scales up relative to the width, the tech tag hides, and the chips wrap.

**Verified:** headless Chrome at 1440×900 and inside a real 390×844 viewport, with and without reduced motion, compared against the design.

**Follow-up:** pointer cursor on the CTA (Tailwind v4 dropped the default `cursor: pointer` on buttons) and the `bg-linear-to-t` class rename, both included in #15.

#### 2. Chat panel — [PR #16](https://github.com/arzljames/pulse-technical-assessment/pull/16)

**Files:** `app/components/ChatPanel.tsx`, `app/page.tsx`, `app/globals.css`, `lib/webrtc.ts`, `lib/geocode.ts` (new)

**Before:** a flat zinc-950 full-height side panel at every screen size, covering the whole map on mobile. "Stranger / Connected" header with a text "Video" button and a red "End", emerald bubbles with no timestamps, and a separate Send button. No typing feedback, location context, or way to move on except End.

**After:**

- **Responsive shell:**
  - Desktop: a 400px frosted side panel that slides in from the right, with the map still visible and usable.
  - Mobile: a bottom sheet (62dvh) with a grab handle that slides up over the map, with safe-area padding for the iOS home bar.
- **Header:** ember avatar tile with a status dot (green when connected, blinking amber while connecting), "Stranger", "Connected · _Cagayan de Oro_" with the city in accent, an icon video button, and a softer red End.
- **Messages:** a "🔒 Peer-to-peer · never stored" chip at the top of every chat, rounded bubbles (periwinkle with dark text for mine, slate for theirs), mono `HH:MM` timestamps under each, and a subtle pop-in.
- **Typing indicator:** three bouncing dots in a bubble while the stranger types.
- **Composer:** ⏭ skip button, an input with the send button inside it (greyed until there's text), autofocus once connected, and a 2,000-char cap.

**New behaviour the design required:**

- **City in the header** (`lib/geocode.ts`): reverse-geocodes the peer's dot with Mapbox Geocoding v6 (`types=place`, falling back to `region`), reusing the existing public token. Results are cached per ~1 km grid cell, and any failure just hides the city.
  - _Privacy reasoning:_ the coordinates are the peer's **public** dot, already offset 1–3 km and visible to every user on the map, and only a city-level name is requested. No new information is revealed.
- **Typing indicator:** a new `typing` value in `PeerControl`, sent over the existing data channel. The sender pings at most once every 2 s while the draft is non-empty. The receiver shows the dots, hides them 3.5 s after the last ping or as soon as a message arrives, and clears them on teardown. It never touches the server.
- **Skip to someone new:** `skipToNext()` ends the current chat (normal `end`, so busy is freed) and immediately requests a random non-busy stranger other than the one just left. With no one free, it shows "No one else is free right now."
- `ChatMessage` gained `at` (epoch ms) for timestamps.

**Why these choices:**

- A bottom sheet on mobile instead of a full-screen panel: keeping the map visible keeps the "you're talking to a dot over _there_" feeling that makes Pulse different from a generic chat app.
- Skip rather than only End: it turns a dead end into a loop, which is the core behaviour of stranger-chat apps and makes the globe feel more alive.
- Location as a city name, not distance: it's warmer ("Cagayan de Oro") and doesn't imply false precision about an offset dot.

**Accessibility:** the message list is `role="log"` + `aria-live="polite"` so screen readers announce new messages. Icon-only buttons have `aria-label`s and titles. Sheet, panel, message and typing animations are off under `prefers-reduced-motion`.

**Verified:** rendered with sample data on a temporary preview route (deleted, not committed) in headless Chrome at 1440×900 and in a real 390×844 viewport, and compared against both designs. Two tweaks came out of that check: tail-less bubbles, and a softer End red to match. Live typing and geocoding still need a two-browser test.

**Follow-up — 12-hour time + city and country** ([PR #17](https://github.com/arzljames/pulse-technical-assessment/pull/17), stacked on #16)

- **Timestamps:** 24-hour `07:02` → 12-hour `7:02 AM` (`toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })`).
- **Location:** "Cagayan de Oro" → "Cagayan de Oro, Philippines". The country comes from `context.country.name` in the same Mapbox v6 response (no extra request). The region fallback becomes "Region, Country", and the country isn't repeated when it equals the name.
- **Language:** testing against the live API showed Mapbox returns local script by default (Tokyo → `杉並区, 日本`). It now passes `language=` from the viewer's browser, so Tokyo → `Suginami, Japan`.
- **Verified live:** CDO → _Cagayan de Oro, Philippines_, Davao → _Davao City, Philippines_, Tokyo → _Suginami, Japan_, Paris → _Paris, France_, open sea → none (city hidden).

#### 3. Connection and video request prompts — [PR #18](https://github.com/arzljames/pulse-technical-assessment/pull/18)

**Files:** `app/components/RequestModal.tsx` (new), `app/components/VideoRequestCard.tsx` (new), `app/components/icons.tsx` (new), `lib/useCountdown.ts` (new), `app/page.tsx`, `app/components/ChatPanel.tsx`, `lib/geocode.ts`, `lib/geo.ts`, `lib/webrtc.ts`, `app/globals.css`; removed `ConnectionPrompt.tsx`

**Before:**

- _Connection requests:_ the sender got a small "Requesting connection… [Cancel]" pill. The receiver got a generic grey "A stranger wants to connect" box with no timer. Outcomes were toasts ("No answer.", "Request declined.").
- _Video:_ the same generic box ("Start video call?") covered the whole screen, and the sender only saw a "Waiting for stranger to accept video…" pill. There was no timeout on either side, and the receiver had no auto-decline.

**After — connection requests** (one `RequestModal`, five states, centered over a dimmed and slightly blurred map):

| State                       | Side     | Ring / eyebrow                             | Actions                         |
| --------------------------- | -------- | ------------------------------------------ | ------------------------------- |
| Requesting to connect       | sender   | ember countdown arc · WAITING FOR RESPONSE | Cancel request                  |
| A stranger wants to connect | receiver | accent countdown arc · INCOMING REQUEST    | Decline · Accept                |
| Request timed out           | sender   | static · NO RESPONSE                       | Back to map · Try again         |
| Not this time               | sender   | static · DECLINED                          | Back to map · Find someone else |
| Request expired             | receiver | static · MISSED                            | Back to map                     |

Every state shows an info card with **approximate location** ("Near Digos, Davao del Sur"), **distance** ("~2 km") and the countdown ("0:22" / "—"), plus the privacy note. Esc triggers the outline action, the likely next action is focused, and the dialog is labelled for screen readers.

**After — video requests** (inline cards above the chat composer, so the conversation stays visible):

- _Incoming:_ "Stranger wants to turn on video", countdown and draining progress bar, "Your camera stays off until you accept", and Decline · Accept.
- _Outgoing:_ "Waiting for Stranger" with animated dots, a countdown that turns red under 10 s, Cancel, and a **live mirrored self-preview** ("You · preview") with mic and camera toggles.
- The header video button turns accent while a request or call is in progress. On mobile the sheet grows from 62dvh to 85dvh while a card is shown.

**Behaviour added to support the design:**

- **Receiver auto-decline (28 s):** sends `decline` with payload `"timeout"`. The sender maps that to _timed out_ instead of _declined_. 28 s instead of 30 s so the decline arrives (≤ 1 poll) before the sender's own 30 s fallback fires.
- **Outcome cards instead of toasts:** an `Outcome { kind, peerId, peer }` state keeps a snapshot of the stranger's dot, so the card still shows location and distance even if they've left. _Try again_ checks they're still online and free. _Find someone else_ requests a random free stranger.
- **Video request timeouts (30 s, both sides).** Previously a request could hang forever.
- **Pre-accept camera preview:** the sender's camera opens when they ask, which is clearer consent ("this is what they'll see"). The stream is handed to `PeerSession.startVideo(existing)` on accept, so there's no second permission prompt. On cancel, decline, timeout or teardown, the tracks are stopped and the camera light goes off.
- **Location formatting:** `reverseGeocode` now returns `{ name, region, country }`. The chat header uses "City, Country", and the modal uses "Near City, Region". Mapbox models big cities as their own region (Davao City → region "Davao City"), so in that case it falls back to the country ("Near Davao City, Philippines"). Verified live: Digos → _Near Digos, Davao del Sur_, Tagum → _Near Tagum, Davao del Norte_.
- **Distance:** haversine from my (raw, client-only) location to their offset dot, rounded deliberately coarsely (`~2 km`, `~45 km`, `~1,240 km`) because the dot itself is offset 1–3 km.

**Why these choices:**

- _A modal for connection requests, inline cards for video:_ a connection request is a context switch (you're about to talk to someone new), so it gets the user's full attention. A video request happens _inside_ an existing conversation, so it stays in the chat instead of covering it.
- _Visible countdowns everywhere:_ uncertainty is the worst part of waiting on a stranger. A draining ring or bar answers "how long until I know?" at a glance.
- _Outcome cards with a next step:_ "No answer." as a toast was a dead end. Each outcome now offers the obvious next move (try again / someone else / back to map).

**Verified:** all five request states (desktop) and both video cards (390×844) rendered on a temporary preview route (deleted, not committed) and compared with the designs. Two fixes came out of the check: replaced Chrome's thick white default focus ring with a subtle accent ring, and grew the mobile sheet while a video card is open so messages stay visible.

**Still to test in two browsers:** accept / decline / expiry on both sides, the preview → call handoff without a second camera prompt, and the camera light turning off after cancel/timeout.

#### 4. Live video call — [PR #19](https://github.com/arzljames/pulse-technical-assessment/pull/19)

**Files:** `app/components/VideoPanel.tsx`, `app/components/ChatPanel.tsx`, `app/page.tsx`, `app/components/icons.tsx`

**Before:** a full-screen black overlay at `z-30` that **covered the chat** (B16). The remote video filled the screen, the self-view was a small fixed rectangle, and the only control was a big "End video" button at the bottom. There was no mute, no camera toggle, no call timer and no indication of who you were talking to. User feedback was that there was "no control and no way to end the call aside from closing the browser".

**After:**

- **Layout that keeps the conversation:** the stage takes the space left of the 400px chat panel on desktop, or the top 45% above the chat sheet on mobile (the sheet shrinks to 55dvh via a new `inCall` prop). You can keep typing during a call.
- **Top bar:** blinking red live dot, mono **call timer** (`09:24`, ticking each second), "Stranger · Cagayan de Oro" (city from the geocoded `Place`), and a `🔒 Peer-to-peer` badge (desktop).
- **Stage:** the stranger's video fills it (`object-cover`). Until their stream arrives there's an ember avatar tile and "Waiting for stranger's video…".
- **Self view:** a mirrored "You" tile, bottom-right on desktop (moved to top-right on mobile after the visual check showed it crowding the short stage). It shows an avatar when the camera is off and a red muted badge when the mic is off.
- **Control bar (floating, centred):** mic toggle · camera toggle (red when off) · **Show map** · red **End video**. The header's End button still ends the whole connection.
- **Show map:** the stage goes transparent and click-through so the live map is usable, and the stranger's video shrinks to a floating tile at top-left. The **same `<video>` elements stay mounted** and only their container's classes change, so remote audio never cuts out when toggling.
- **Chat system lines:** "Video call started · 7:04 AM" / "Video call ended · …" as centred pills (new `system` flag on `ChatMessage`), posted on both sides via `callStarted()` / `callEnded()`, whoever hangs up.

**Why these choices:**

- _Video beside chat, not over it:_ in a stranger app the text channel is the safety valve. You can say "brb" or "your audio is broken" without ending the call, and you never lose the conversation history when video starts.
- _Show map:_ keeps the "talking to a dot somewhere on Earth" feeling during a call, which is the thing that makes Pulse different from a generic video chat.
- _Separate End video vs End:_ hanging up video drops you back to text with the same person. End leaves the conversation entirely. Two distinct, clearly labelled actions avoid accidentally losing the stranger.

**Verified:** rendered on a temporary preview route (deleted) at 1280×720 and 390×844 and compared with the design. Still to test in two browsers: toggles reflected on the remote side, End video on either side returning both to text with the system line, and Show map keeping audio.

### 2.2 Ideas considered (backlog)

- **Entry screen:** add an animated globe or pulse hero, explain the privacy model visually, and offer a "use approximate location" fallback (IP or manual pick on the map) when permission is denied.
- **Map:** use globe projection (`projection: "globe"`) with atmosphere/fog and a slow auto-rotate while idle. Cluster dots when zoomed out. Show distinct styles for available, busy, and requesting dots, and pulse the dot you're requesting.
- **Requests:** add a countdown ring on the outgoing request and an incoming request card with sound or vibration and a timer. Show the approximate distance ("~240 km away") and local time of day.
- **Chat:** slide-in panel with typing indicator and delivery ticks over the data channel. Add an emoji/quick-reply bar, auto-focus the input, and a "Stranger left" end state with a "Find someone new" call to action. Handle mobile keyboards with a bottom sheet on small screens.
- **Video:** picture-in-picture chat overlay, mute/camera/flip-camera buttons, a draggable self-view, a connection quality indicator, and a camera preview before accepting.
- **Feedback:** toast stack instead of a single notice, an offline/reconnecting banner when polls fail, and skeleton or loading states while the map loads.
- **Accessibility:** focus trap and Esc key in prompts, `aria-live` for notices and incoming messages, keyboard-reachable dots (they're buttons but have no label), and `prefers-reduced-motion` support.
- **Polish:** a consistent design token palette, Geist font (B18), favicon/OG image/PWA manifest, and a dark/light theme.

---

## 3. SECURITY REVAMP (Phase 3)

### 3.1 Findings, ranked

#### ✅ 🔴 S1. No session auth, and every session id is public — FIXED in [PR #24](https://github.com/arzljames/pulse-technical-assessment/pull/24) (see Fix log)

- `/api/poll` returns every peer's `id`, and that id is the only credential for all endpoints. With someone else's id, anyone can:
  - **Read their mailbox:** `GET /api/poll?id=<victim>` drains their signals (requests, SDP, ICE). Signals vanish from the victim and can be used to hijack or MITM the WebRTC handshake.
  - **Impersonate them:** `POST /api/signal` takes `fromId` from the request body unchecked, so anyone can send requests, offers, or `end` as the victim.
  - **Kick them:** `POST /api/leave {id}` deletes anyone's presence.
  - **Move them:** `POST /api/join {id}` upserts and moves anyone's dot.
- **Fix:** `join` issues a random secret session token (httpOnly cookie, or a bearer token held in memory). The server derives `fromId` from the token. Never accept the caller's identity from the body or query string. Expose only an opaque **public** id per dot, separate from the secret one.

#### ✅ 🔴 S2. Busy-flag DoS — FIXED in [PR #25](https://github.com/arzljames/pulse-technical-assessment/pull/25) (see Fix log)

- Sending `accept` with forged ids marks any users busy permanently (B3 makes it permanent even without forgery). One script can mark the whole map "busy".
- **Fix:** the server tracks pending requests and only accepts `accept` from a target with a matching pending request (state machine on the server).

#### ✅ 🟠 S3. No rate limiting or flood protection — FIXED in [PR #26](https://github.com/arzljames/pulse-technical-assessment/pull/26) (see Fix log)

- Request spam and harassment of one user, unlimited 64 KB signals to arbitrary `toId`s (stored until TTL, even for ids that don't exist), and join/poll hammering.
- **Fix:** per-session and per-IP limits on `/api/signal` and `/api/join`. Check that `toId` exists and is the active or pending peer. Disallow `toId === fromId`. Lower the payload cap (about 16 KB is plenty for SDP).

#### ✅ 🟠 S4. Location scraping without joining — FIXED in [PR #27](https://github.com/arzljames/pulse-technical-assessment/pull/27) (see Fix log)

- `/api/poll?id=anything` returns all dots without a presence row. Combined with B7-style re-joins, each user's own repeated sessions (new random offset each time, mean = true location) allow **averaging attacks** to recover the real location.
- **Fix:** require a joined session to poll. Consider snapping to a grid cell plus jitter, or a stable per-day offset, instead of a fresh uniform offset centered on the true point.

#### ✅ 🟠 S5. WebRTC exposes the peer's public IP — FIXED in [PR #28](https://github.com/arzljames/pulse-technical-assessment/pull/28) (see Fix log)

- With STUN-only P2P, each stranger sees the other's IP (and so a coarse location and ISP). This undercuts the 1–3 km privacy promise.
- **Fix:** document it. Optionally offer TURN relay-only (`iceTransportPolicy: "relay"`) as a "privacy mode".

#### ✅ 🟠 S6. Weak input validation — FIXED in [PR #29](https://github.com/arzljames/pulse-technical-assessment/pull/29) (see Fix log)

- Ids in `poll`/`signal`/`leave` have no length or format check (`join` checks 8–64 chars only). They should be validated as UUIDs.
- `type` is stored as a free string in the DB.
- Data channel messages have no size cap or chat length limit, so a peer can send huge messages and exhaust memory.

#### 🟡 S7. Errors aren't handled

- Prisma exceptions surface as generic 500s with no `try/catch` or logging. Return controlled errors.

#### 🟡 S8. No security headers

- Add CSP, `Permissions-Policy` (camera/microphone/geolocation=self), `Referrer-Policy`, and `X-Content-Type-Options`.
- In Next 16, `middleware` is now `proxy.ts` (see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`), or use `headers()` in `next.config.ts`.

#### 🟡 S9. Mapbox token isn't restricted

- Restrict the public token to the production URL in the Mapbox dashboard.

#### ✅ 🟡 S10. Untrusted control messages — FIXED in [PR #29](https://github.com/arzljames/pulse-technical-assessment/pull/29) (control allowlist, part of S6)

- `onControl` casts any string to `PeerControl` without validating it. It's harmless today because of the `switch`, but should be validated.

✅ **Good already:** chat text is rendered as React text (no XSS), raw coordinates are never stored, and Prisma queries are parameterized.

### 3.2 Fix log

#### S1 — Server-issued session tokens

**PR:** [#24](https://github.com/arzljames/pulse-technical-assessment/pull/24)

**Files:** `lib/session.ts` (new), `app/api/session/route.ts` (new), `app/api/{join,poll,signal,leave}/route.ts`, `lib/api.ts`, `app/page.tsx`, `.env.example`

**Problem:** The dot id the client made up (`crypto.randomUUID()`) was the only credential, and `/api/poll` hands every id to everyone. With a victim's id anyone could drain their mailbox and hijack their WebRTC handshake, send `request`/`offer`/`end` as them (`fromId` came straight from the body), kick them (`leave {id}`), or move their dot (`join {id}`).

**How found:** Code review of the four API routes. None of them checked who was calling. Confirmed with curl: `GET /api/poll?id=<someone else>` returned and deleted their signals.

**Fix:**

- New `lib/session.ts` and `POST /api/session`. The server issues `{ id, token }`, where `token = id + "." + HMAC-SHA256(id, SESSION_SECRET)`. Tokens are stateless: they're verified by recomputing the HMAC (with a timing-safe compare), so nothing is stored and a token survives its presence row being reaped.
- `join`, `poll` and `signal` read `Authorization: Bearer <token>` and **derive the caller's id from it**. `leave` takes the token in the body, because `sendBeacon` can't set headers. Ids in the body or query are no longer trusted.
- `signal` also requires `toId` to be a UUID other than the caller (a slice of S6).
- Client: the session is held **in memory**, not in a cookie. A cookie is shared by all tabs, and two tabs in one browser must be two sessions (that's how people test this app). An effect mints a session when going live, after a panic, and after any 401. The first poll (`joined:false`) then joins.
- `SESSION_SECRET` is in `.env.example`. It's required in production. Dev falls back to a random secret per process, so restarting `next dev` signs everyone out, and they recover on their next poll.

**Before:**

```ts
// app/api/signal/route.ts
const { fromId, toId, type, payload } = body;
if (typeof fromId !== "string" || typeof toId !== "string") {
  /* 400 */
}

// app/api/poll/route.ts
const id = request.nextUrl.searchParams.get("id");

// app/page.tsx
const [sessionId] = useState(() => crypto.randomUUID());
void sendSignal(sessionId, peerId, "request");
```

**After:**

```ts
// lib/session.ts
export function issueSession() {
  const id = randomUUID();
  return { id, token: `${id}.${sign(id)}` };
}
export function sessionFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return verifyToken(header.slice("Bearer ".length));
}

// app/api/signal/route.ts
const fromId = sessionFrom(request);
if (!fromId) return unauthorized();
const { toId, type, payload } = body;
if (!isSessionId(toId) || toId === fromId) {
  /* 400 */
}

// app/page.tsx
const [session, setSession] = useState<Session | null>(null);
const token = session?.token ?? "";
void sendSignal(token, peerId, "request");
```

**Result (curl against `next dev`):**

- poll with no token, the old `?id=victim`, or a forged signature → **401**
- join with no token → **401**
- signal with a spoofed `fromId` → delivered as from the real caller
- signal to self → **400**
- `leave {id: victim}` → **401**, and the victim stays online
- the valid-token flow works end to end

**Still open:**

- ~~**S2:**~~ fixed in [PR #25](https://github.com/arzljames/pulse-technical-assessment/pull/25).
- **S3/S4:** rate limiting, and poll returning peers to a session that never joined.
- Set `SESSION_SECRET` in Vercel before deploying.

---

#### S2 — Server-side connection state

**PR:** [#25](https://github.com/arzljames/pulse-technical-assessment/pull/25)

**Files:** `prisma/schema.prisma`, `app/api/signal/route.ts`, `app/api/leave/route.ts`, `app/api/poll/route.ts`, `lib/api.ts`, `app/page.tsx`

**Problem:** After S1 nobody can impersonate anyone, but the server still delivered any signal between any two ids and flipped `busy` blindly:

- `accept` to any stranger marked both of you busy, so a script could grey out the whole map
- `end` to someone else's peer freed them mid-chat
- `leave` trusted a client-supplied `peerId`

**How found:** Following on from S1. The signal route has no notion of "who is talking to whom", so every transition is taken on the caller's word.

**Fix:**

- `Presence.requestTo` and `Presence.peerId` (nullable; `prisma db push`) record the server's view of each session's connection.
- `/api/signal` only delivers signals that fit that state:
  - `request`: caller must be joined and free. It sets `requestTo`.
  - `accept` / `decline`: the target's `requestTo` must be the caller. `accept` claims it with a conditional `updateMany`, so it's atomic.
  - `end`: caller must be connected to the target, or withdrawing their own request.
  - `offer` / `answer` / `ice`: only between connected peers.
  - Everything else gets 409. A late accept also sends the accepter `end`, so they don't sit on "Connecting…".
- `/api/leave` uses server state to free the peer, withdraw our request and notify anyone requesting us. The client no longer sends `peerId`.
- `/api/poll`'s reaper frees and notifies the peer of a reaped session, and drops requests aimed at it.
- Client: Skip now waits for its `end` to be processed before requesting the next person, since requests require a free caller.

**Before:**

```ts
// app/api/signal/route.ts
if (signalType === "accept") {
  await prisma.presence.updateMany({
    where: { id: { in: [fromId, toId] } },
    data: { busy: true },
  });
}
await prisma.signal.create({
  data: { fromId, toId, type: signalType, payload },
});
```

**After:**

```ts
case "accept": {
  const requester = await prisma.presence.updateMany({
    where: { id: toId, requestTo: fromId, busy: false },
    data: { requestTo: null, busy: true, peerId: fromId },
  });
  if (requester.count === 0) {
    await deliver(toId, fromId, "end");
    return rejected("no pending request from that session");
  }
  const me = await prisma.presence.updateMany({
    where: { id: fromId, busy: false },
    data: { requestTo: null, busy: true, peerId: toId },
  });
  // ...undo + decline if we turned out to be busy
}
```

**Result (curl, four sessions):**

- Forged `accept`/`end`/`decline`/`offer` with no relationship → 409, and nobody became busy.
- A requests B, B accepts → both busy. A third session accepting A's request, sending `ice`, or ending B → 409, and A and B stay busy.
- A leaves without sending `peerId` → B is freed and gets `end`.
- C requests then cancels → B gets `end`. B's late accept → 409 plus `end`, and B stays free.
- The schema is pushed to the dev DB (additive).

**Still open:** S3 (rate limiting), and S4 (poll still returns peers to a session that hasn't joined).

---

#### S3 — Rate limiting and flood protection

**PR:** [#26](https://github.com/arzljames/pulse-technical-assessment/pull/26)

**Files:** `prisma/schema.prisma` (`RateLimit`), `lib/rateLimit.ts` (new), `app/api/{session,join,poll,signal}/route.ts`, `lib/api.ts`, `app/page.tsx`

**Problem:** No endpoint limited call volume:

- request → cancel → request again could harass one person forever
- `/api/session` minted unlimited identities
- join and poll could be hammered, and every join re-randomizes the offset, which feeds the S4 averaging attack
- signal payloads could be 64 KB

(S2 already blocks signals to strangers you have no relationship with, and S1 blocks self-signals.)

**How found:** Listed in the security review. The routes had no counters of any kind.

**Fix:**

- **Storage:** Postgres-backed fixed-window counters. In-memory limits would be per serverless instance and easy to spread across instances. Each check is one atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING`.
- **Responses:** over the limit → 429 with `Retry-After`. The limiter fails open if the counter errors.
- **Limits (per minute unless noted):**
  - session: 20 per IP
  - join: 10 per session, 60 per IP
  - poll: 90 per session (the client polls at about 40)
  - signal: 240 per session, 1200 per IP
  - request: 10 per session, and **3 per 5 min to the same person**
- **Payload cap:** 16 KB, down from 64 KB.
- **Cleanup:** old counters are swept by about 2% of polls.
- **Client:** a 429 on a request ends it immediately with a notice, instead of waiting out the 30 s timeout.

**Why these choices:**

- _Per-session limits are primary:_ since S1, sessions can't be forged. Per-IP limits are a backstop, because `x-forwarded-for` is only trustworthy behind Vercel's proxy, and many users can share a NAT (generous IP caps).
- _Fail open:_ a limiter outage shouldn't take down chat. The worst case is the pre-S3 behavior.
- _A per-pair request limit:_ it targets harassment specifically, without stopping someone from trying several different people.

**Before:**

```ts
// app/api/signal/route.ts
const MAX_PAYLOAD = 64 * 1024;
const fromId = sessionFrom(request);
if (!fromId) return unauthorized();
// ...no limits
```

**After:**

```ts
const MAX_PAYLOAD = 16 * 1024;
const fromId = sessionFrom(request);
if (!fromId) return unauthorized();
const limited = await rateLimit(
  { key: `signal:${fromId}`, max: 240, windowMs: MINUTE },
  { key: `signal-ip:${clientIp(request)}`, max: 1200, windowMs: MINUTE },
);
if (limited) return limited;
// ...and for "request":
const spam = await rateLimit(
  { key: `request:${fromId}`, max: 10, windowMs: MINUTE },
  { key: `request-pair:${fromId}:${toId}`, max: 3, windowMs: 5 * MINUTE },
);
```

**Result (curl):**

- session from one IP: 20 × 200, then 429 (`Retry-After: 54`)
- join: 10 × 200, then 429
- request + cancel to the same person: 3 × 200, then 429
- a 17 KB payload → 400
- 95 rapid polls → 90 × 200 and 5 × 429
- the `RateLimit` table is pushed to the dev DB

**Still open:** S4 (poll returns peers to sessions that never joined; offset averaging).

---

#### S4 — Stop map scraping and location averaging

**PR:** [#27](https://github.com/arzljames/pulse-technical-assessment/pull/27)

**Files:** `lib/privacy.ts` (new), `lib/session.ts` (`serverHmac`), `app/api/join/route.ts`, `app/api/poll/route.ts`, `lib/geo.ts` (old offset removed), copy in `EntryGate`, `RequestModal`, `StatsPanel`, `HiddenBanner`

**Problem:**

1. `/api/poll` returned every dot to any session, including one that never joined, so the map could be scraped invisibly.
2. Each join moved the real location 1–3 km in a _fresh_ random direction. The samples were random, but they were all centred on the real point, so averaging one person's dots across re-joins, reloads and panics converged on their home. B7 (auto re-join) and the panic button both generate extra samples.

**How found:** Security review. The offset function's comment even said "a fresh random offset each session", which is exactly what makes it averageable.

**Fix:**

- **Poll:** peers are returned only if the caller has a presence row.
- **`placeDot`:**
  - Snap to a ~2 km grid cell (columns widen with latitude).
  - Place the dot at the cell's **anchor**, chosen by `HMAC(secret, cell + UTC day)`. It's the same for everyone in the cell that day, and unpredictable without the secret.
  - Add ≤ 250 m of per-join jitter, so people in one cell don't overlap.
  - Averaging recovers only the anchor, which reveals only the cell.
- **Copy:** "1–3 km" becomes "~2 km area". The hidden banner notes the map pauses.

**Before:**

```ts
// lib/geo.ts
export function applyPrivacyOffset(lat, lng) {
  const distanceKm = 1 + Math.random() * 2; // 1–3 km
  const bearing = Math.random() * 2 * Math.PI; // random direction
  ...
}
// app/api/poll/route.ts
const peers = await prisma.presence.findMany({ where: { id: { not: id }, ... } });
```

**After:**

```ts
// lib/privacy.ts
const row = Math.floor(lat / cellLat);
const col = Math.floor(lng / cellLng);
const h = serverHmac(`dot:${row}:${col}:${day}`);
const anchorLat = (row + h.readUInt32BE(0) / 2 ** 32) * cellLat;
const anchorLng = (col + h.readUInt32BE(4) / 2 ** 32) * cellLng;
// + up to 250 m random jitter
// app/api/poll/route.ts
const peers = heartbeat.count === 0 ? [] : await prisma.presence.findMany({ ... });
```

**Result (curl):**

- A never-joined session gets `peers=0`.
- 13 sessions joining from the same real spot:
  - dots are 0.60–1.04 km away
  - all dots are within 0.25 km of their mean
  - the mean is 0.85 km from the real spot (the anchor), and more samples don't get closer

**Trade-offs:**

- **No minimum displacement:** someone near their cell's anchor is shown close to home, but nobody can tell who, since the whole cell shares the anchor.
- **Cell edges:** crossing a cell edge reveals that strip.
- **Panic:** the dot after a panic lands near the same anchor. The random rejoin delay still breaks the timing link.

**Still open:** S5–S10.

---

#### S5 — Disclose IP exposure, add relay-only "Hide my IP"

**PR:** [#28](https://github.com/arzljames/pulse-technical-assessment/pull/28)

**Files:** `app/api/ice/route.ts` (new), `lib/webrtc.ts`, `lib/api.ts`, `app/page.tsx`, `app/components/EntryGate.tsx`, `.env.example`

**Problem:** Chat and video are peer-to-peer over STUN, so each stranger learns the other's public IP (roughly city and ISP). That quietly undercuts the "~2 km area" location promise, and nothing told users.

**How found:** Security review. `ICE_CONFIG` was STUN-only, with no relay option and no disclosure.

**Fix:**

- **Disclosure:** a "Hide my IP address" card on the landing page explains that direct connections show your IP. It's always visible.
- **Relay-only mode** (opt-in, persisted): `iceTransportPolicy: "relay"`, so only TURN candidates are gathered and the stranger only sees the relay's address. Media stays DTLS-encrypted end to end. With no reachable relay it fails closed, rather than falling back to direct.
- **`GET /api/ice`:**
  - without a token → `{ relayAvailable }`, for the landing switch
  - with a token → STUN plus TURN with **short-lived credentials** (TURN REST / coturn `use-auth-secret`: `username = expiry:sessionId`, `credential = HMAC-SHA1(secret, username)`, 1 h), rate limited
- **Client:** `PeerSession` takes its config from the page, which fetches it per session and refreshes it every 30 min.
- **Config:** `TURN_URLS` and `TURN_SECRET`. When unset, the switch is disabled and says why.

**Why these choices:**

- _Opt-in, not default:_ relaying costs bandwidth and latency, and it needs a TURN server the project doesn't have yet. Disclosure is the part every user gets.
- _Ephemeral credentials:_ a static TURN password in the client bundle would let anyone use the relay for free.
- _Fail closed:_ someone who asked to hide their IP must never silently connect directly.

**Before:**

```ts
// lib/webrtc.ts
const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};
this.pc = new RTCPeerConnection(ICE_CONFIG);
```

**After:**

```ts
// app/page.tsx
const config: RTCConfiguration = hideIpRef.current
  ? { ...iceRef.current, iceTransportPolicy: "relay" }
  : iceRef.current;
const ps = new PeerSession(initiator, callbacks, config);

// app/api/ice/route.ts
const username = `${Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS}:${id}`;
const credential = createHmac("sha1", secret).update(username).digest("base64");
iceServers.push({ urls, username, credential });
```

**Result:**

- **No TURN env:** `relayAvailable:false`, STUN only, and the switch is disabled with the explanation (screenshot).
- **Fake TURN env:** the credential verifies with the coturn rule, expires in 60 min, and is tied to the session. The switch is enabled and the saved choice is restored (screenshot).
- **Not verified:** a real relayed call (no TURN server here). To test it, run coturn with `use-auth-secret` and check `chrome://webrtc-internals` for `relay` pairs.

**Follow-up — [PR #30](https://github.com/arzljames/pulse-technical-assessment/pull/30):** with no TURN server set up, the switch could only show as disabled, so the card is now hidden unless `/api/ice` reports a relay. It reappears automatically once `TURN_URLS` and `TURN_SECRET` are set. The relay code is unchanged. Trade-off: while hidden, the landing page no longer discloses that direct connections show your IP.

**Still open:** S6–S10.

---

#### S6 — Strict input validation on the API and data channel (also S10)

**PR:** [#29](https://github.com/arzljames/pulse-technical-assessment/pull/29)

**Files:** `lib/http.ts` (new), `app/api/{join,leave,signal}/route.ts`, `prisma/schema.prisma` (`SignalType` enum), `lib/webrtc.ts`, `app/page.tsx`

**Problem:**

- `Signal.type` was free text in the DB.
- Routes parsed bodies of any size before checking anything.
- Any payload string was relayed to the other browser.
- Data channel messages (which never touch the server) had no size cap, chat length limit or rate limit. A stranger could flood the other tab with huge or endless messages, or send unknown control strings (S10). (The id-format part of S6 was already handled by S1/S2.)

**How found:** Security review of every place the app accepts input, both server routes and the peer-to-peer channel.

**Fix:**

- **Server:**
  - `readJson(request, maxBytes)` caps body size (from Content-Length before reading, re-checked after) → 413, and accepts JSON objects only. Caps: join/leave 1 KB, signal 17 KB.
  - Payload shape per type: none for request/accept/end; none or `"timeout"` for decline; a matching `RTCSessionDescription` for offer/answer; an `RTCIceCandidate` for ice.
  - `Signal.type` is a Postgres enum.
- **Data channel:**
  - text frames ≤ 8 KB only
  - chat trimmed, non-empty, ≤ 2000 chars
  - chat flood guard: 30 per 5 s (reveal/control updates aren't counted, so a slider drag never loses its last value)
  - control allowlist (S10)
  - chat history capped at 500 in memory

**Before:**

```ts
// lib/webrtc.ts
dc.onmessage = (e) => {
  const msg = JSON.parse(e.data as string);
  if (msg.t === "chat" && typeof msg.text === "string")
    this.cb.onChat(msg.text);
  else if (msg.t === "ctrl" && typeof msg.ctrl === "string")
    this.cb.onControl(msg.ctrl as PeerControl);
};
// app/api/signal/route.ts
body = await request.json();
```

**After:**

```ts
dc.onmessage = (e) => {
  if (typeof e.data !== "string" || e.data.length > MAX_MESSAGE_BYTES) return;
  const msg = JSON.parse(e.data);
  if (msg.t === "chat" && typeof msg.text === "string") {
    if (this.flooding()) return;
    const text = msg.text.trim();
    if (text && text.length <= MAX_CHAT_CHARS) this.cb.onChat(text);
  } else if (msg.t === "ctrl" && CONTROLS.includes(msg.ctrl)) {
    this.cb.onControl(msg.ctrl as PeerControl);
  }
};
// app/api/signal/route.ts
const parsed = await readJson(request, MAX_BODY);
if (!parsed.ok) return parsed.response;
if (!validPayload(signalType, payloadStr)) return /* 400 */;
```

**Result:**

- **curl:**
  - oversized join, signal and leave bodies → 413; an array body → 400
  - a request with a payload, decline `"nope"`, an offer with junk, and an offer whose payload says `answer` → 400
  - real shapes → 200, and only valid signals reached the mailbox
- **Headless Chrome** (two local PeerSessions):
  - the 2001-char chat, binary frame, 9 KB frame and unknown control were all dropped
  - 40 rapid chats stopped at the 30/5 s cap (29 delivered; the oversized one also counted)
  - `typing` was delivered
- **Schema:** pushed to the dev DB without data loss.

**Still open:** S7 (error handling), S8 (security headers), S9 (restrict the Mapbox token, a dashboard setting).

---

## 4. NEW FEATURES (Phase 4)

### 4.1 Safe Reveal (safe video) — ✅ [PR #20](https://github.com/arzljames/pulse-technical-assessment/pull/20), [PR #23](https://github.com/arzljames/pulse-technical-assessment/pull/23)

Built without the TensorFlow.js guard.

**What shipped (PR #20):**

- **Consent blur:** both feeds start at 40px blur. "Reveal me" slider (0–100%, step 5) in `VideoPanel`. The level is sent as `{ t: "reveal", level }` over the data channel (`PeerSession.sendReveal` / `onReveal`); `clampLevel` drops NaN/Infinity and clamps to 0–1. The self view shows your own blur ("You · 25%").
- **Status + override:** a chip on the remote feed ("Stranger hasn't revealed yet" / "Stranger is revealing… 40%") and an eye button that re-hides the stranger regardless of their level (replaces the guard's "Keep blurred").
- **Panic button:** shield button in the chat header (visible during calls too). It blocks the stranger's id (`blocked` set, filtered from the map and random-pick, and their requests are auto-declined), calls `leave(oldId, peerId)`, then rejoins under a **new session id** with a fresh offset. Why a new id rather than just moving the dot: the blocked person can no longer address requests to us at all.
- **Stay hidden after panic** ✅ [PR #21](https://github.com/arzljames/pulse-technical-assessment/pull/21) → re-opened against main as [PR #23](https://github.com/arzljames/pulse-technical-assessment/pull/23): an immediate rejoin made the new dot easy to link to the old one (same 1–3 km area, appearing about 1 s after the old one vanished). Now you stay off the map (the poll's auto re-join is skipped while `hidden`) until you tap **Go back**, and the rejoin is never earlier than a random 30–90 s after the panic (countdown, with **Stay hidden** to cancel). Requests are disabled while hidden. `HiddenBanner.tsx` is new; no server change.
- **Edge cases:** reveal resets to 0 when a call ends, never on start (the peer may reveal before our own start lands); reveal arriving before the remote stream is simply stored; `prefers-reduced-motion` snaps the blur.
- **Not built:** part 2 (NSFWJS on-device guard), by request. **Trade-off:** blur is receiver-applied, so a modified client could ignore it. Next step: sender-side blur via canvas `captureStream` + `replaceTrack`.
- **Verified:** lint clean; rendered with fake canvas streams at 1280×720 and 390×844 on a temporary route (deleted). Two-browser test still pending.

**Original plan:**

**One-liner:** Video starts blurred. Each person decides how much of themselves to reveal, and an on-device guard re-blurs anything explicit before you see it. No video ever leaves the browser.

**Why this one:**

- It targets the #1 real-world risk of anonymous video chat: unwanted explicit content the moment the camera turns on. Pulse currently has no protection at all.
- It _strengthens_ the core promise ("chat and video are never seen or stored by the server"). All moderation runs locally, and nothing is uploaded or logged.
- It fits the constraints: no external services (the model is bundled in `/public`), no accounts, no server state.
- It's demoable in seconds by a reviewer with two windows.

**Parts:**

1. **Blurred start + consent reveal**
   - When a video call goes `active`, both feeds start at maximum blur (`filter: blur(40px)` on the `<video>`).
   - Each user controls **their own** reveal level (0–100%) with a slider or press-and-hold. Your level controls how the _other_ person sees _you_. You also see a preview of how you look to them.
   - The level is sent over the existing data channel as a new control message, e.g. `{ t: "ctrl", ctrl: "reveal", level: 0.6 }`. The receiver applies it to the remote video.
   - Each side shows the other's progress ("Stranger is revealing… 60%"). Reveal is reversible at any time: slide back to blur.
2. **On-device safety guard**
   - Uses NSFWJS (TensorFlow.js, MobileNet-based). Model files are served from `/public/models/`, so there's no CDN or third-party call.
   - **Lazy-loaded** only when a video call starts, so the map and chat stay fast.
   - About twice a second, draw the **incoming** video frame to an offscreen canvas and classify it.
   - If `Porn`/`Hentai` (and optionally `Sexy`) goes above a threshold for N consecutive frames: force full blur on the remote video regardless of the sender's reveal level, and show "Possibly explicit content hidden" with **End call** / **Keep blurred** / **Show anyway**.
   - Optionally tell the sender, via a `guard-tripped` control message, that their video was auto-hidden.
   - Analysis runs on the _receiver's_ device only. Frames are never stored or sent anywhere.
3. **Panic button**
   - Always visible during video and chat. One tap ends the connection, blocks that stranger's session id for the rest of your session, and re-joins with a fresh offset so your dot moves.
   - Blocked ids are filtered from the map client-side, and their requests are auto-declined.

**Files likely touched:**

- `lib/webrtc.ts`: add `reveal` / `guard-tripped` to `PeerControl`, and carry a numeric `level` in control messages (validated 0–1).
- `app/page.tsx`: reveal state (mine and theirs), guard state, panic handler, blocked-id set.
- `app/components/VideoPanel.tsx`: blur styling, reveal slider, status chips, guard overlay, panic button.
- `lib/safetyGuard.ts` (new): lazy model loader, frame sampling loop, hysteresis/threshold logic, cleanup on call end.
- `package.json`: `@tensorflow/tfjs` + `nsfwjs`.
- `public/models/…`: bundled model files.

**Edge cases to handle:**

- The model fails to load (old device, blocked WebGL). Fail **safe**: keep the remote video blurred, label the guard "unavailable", and still allow a manual reveal.
- Performance: throttle sampling, pause it when the tab is hidden, and stop it on `video-end` / teardown.
- Reveal messages arriving before the remote stream: store the level and apply it when the stream attaches.
- Malformed `level` values from the peer: clamp to 0–1 and ignore non-numbers.
- `prefers-reduced-motion`: snap the blur instead of animating it.

**Acceptance criteria:**

- [ ] Both feeds start fully blurred on accepting video.
- [ ] Moving my slider changes only how the stranger sees me, live, in both directions.
- [ ] Explicit test content on one camera (e.g. a test image via a virtual cam) is auto-blurred on the other side within about 1 s, with the override prompt.
- [ ] The guard never sends frames over the network (verify in DevTools → Network).
- [ ] The panic button ends the call, the stranger's dot disappears from my map, and my own dot moves.
- [ ] Map/chat load size is unaffected until video starts (lazy model).

**Risks / trade-offs:**

- **Model size** (a few MB): mitigated by lazy loading and caching.
- **False positives/negatives:** the classifier is a safety net, not a guarantee. The user can always override or end, and the consent blur is the primary protection.
- **CPU on low-end phones:** adapt the sampling rate, or skip the guard and keep blur-only consent.

**Next steps with more time:** an optional anonymous "report" that rate-limits a session server-side, audio safety (e.g. volume spikes), and per-user guard sensitivity settings.

### 4.2 Floating live stats — ✅ [PR #22](https://github.com/arzljames/pulse-technical-assessment/pull/22)

**Before:** a bare "N online" label in the bottom-left corner. There was no sense of who's around or where, and the only way to find someone was hunting dots on the map.

**After (`StatsPanel.tsx`, `lib/continents.ts`):**

- **Expanded panel:**
  - totals: active, in a chat, available
  - per-continent bars, from rough lat/lng boxes
  - "Dots near you" within 100 km, grouped by city via the cached reverse geocoder (capped at 40 lookups), with search, distance chips (≤5/25/100 km/Any), status chips (All/Available/In a chat), time in current status, and Connect / Busy
- **Minimized pill:** count, 4 avatars and `+N`.
- **Dragging:** drag the header or pill, or use the arrow keys. The position and minimized state persist in `localStorage`, clamped to the viewport. Phones start minimized.
- **Placement:** hidden during a video call. The online count moved to a top-right "N online worldwide" chip.

**Why these choices:**

- _Hashed dot labels_ ("Dot · 4F2A"): a stable handle to refer to a dot without exposing characters of the session id. Ids act as credentials for the signal API (see S-issues).
- _Time in status tracked client-side:_ the server doesn't expose join times, and adding them would leak more than it's worth for a "2 min" label.
- _Draggable rather than docked:_ the map is the product. Letting people park the panel (or shrink it to a pill) keeps it from hiding the area they care about.

**Verified:** lint and tsc clean. Rendered expanded and minimized with fake dots on a temporary route (deleted), and compared with the design. Still to test: drag on touch, persistence across reloads, and live counts with a second browser.

### 4.3 Other ideas considered

**Alive**

- **"Pulse waves":** when two people connect, an animated arc draws between their dots for everyone to see (anonymous, no ids), so the globe visibly breathes with activity.
- **Heat or time-of-day layer:** a day/night terminator overlay plus a live activity heatmap. "It's 3 am in Tokyo and 12 people are awake."
- **Shuffle / "Surprise me":** match with a random available stranger, optionally "far away" or "nearby".
- **Mood or topic beacons:** pick an ephemeral emoji or tag before entering (e.g. 🎧 music, 🌍 travel). Dots show it so people can choose who to tap. Nothing is stored.
- **Icebreakers:** a random prompt card when the chat opens, and live translation of chat messages (client-side) for cross-language chats.

**Safe**

- **Report and block for the session:** block a stranger's dot locally, and report it to the server, which rate-limits or hides repeat-reported session ids. Stays anonymous and ephemeral.
- **Consent-first video:** start video blurred, and each side unblurs when ready. → _part of Safe Reveal_
- **Client-side moderation:** on-device NSFW detection on the incoming video (e.g. TF.js / NSFWJS) that auto-blurs and offers to end the call. Nothing leaves the device. → _part of Safe Reveal_
- **Request cooldowns:** if someone declines you, you can't request them again for N minutes. Limit outgoing requests per minute.
- **Privacy mode:** TURN relay-only to hide your IP (S5), plus a larger, coarser location offset.
- **Panic button:** one tap ends the chat, blocks the stranger, and re-randomizes your dot. → _part of Safe Reveal_

---

## 5. NOT FIXED YET

Prioritized: do the urgent items next, and leave the rest for a future pass.

### 🔴 5.1 Urgent — fix next

**Deploy blockers**

- **Two-browser end-to-end pass.** Most PR test plans are still unchecked. Each PR was verified with lint, types, curl and screenshots, but the full flow hasn't been run in two real browsers since the security changes: request → accept → chat → video, reveal slider, panic and stay hidden, skip, live stats counts, and rate limits never firing in normal use.

**Security**

- **S9. Restrict the Mapbox token** to the production URL (and `localhost`) in the Mapbox dashboard. It's a settings change, and without it anyone can use the token against your quota.
- **S7. Error handling.** Prisma errors still surface as generic 500s with no logging. Wrap route bodies, log, and return controlled errors.
- **S8. Security headers.** Add CSP, `Permissions-Policy` (camera, microphone, geolocation = self), `Referrer-Policy` and `X-Content-Type-Options`, via `headers()` in `next.config.ts`.

**Correctness and honesty**

- **Misleading privacy copy.** The outgoing request modal says "They can't see yours until they accept", but every dot is public on the map. Reword it.

### 🟢 5.2 Not urgent — future fixes

**Bugs**

- **B13:** overlapping notices clear each other early.
- **B14:** `requestTimer` isn't nulled after it's cleared.
- **B15:** transceivers pile up across repeated video calls, so the SDP keeps growing. Reuse them with `replaceTrack` or use `transceiver.stop()`.
- **B19:** secure-context APIs fail over plain-http LAN testing. Vercel is HTTPS, so this only affects local network testing.
- **B20:** a leftover ngrok host in `next.config.ts` (`allowedDevOrigins`). Dev only.

**Performance**

- **P1. Poll is heavy.** Each 1.5 s poll does about 6 queries per user, including two **global** `deleteMany` reaps. At N users that's N reaps every 1.5 s. Reap probabilistically (about 1 in 10 polls), on a cron, or with a single SQL statement. Batch the queries in one `$transaction([...])` (non-interactive, which is pooler-safe).
- **P2. Missing indexes.** Add `Signal.createdAt` (for the reap) and `Signal.fromId` (for leave cleanup).
- **P3. Adaptive polling.** Poll faster (about 500 ms) during signaling and slower when idle, or switch to SSE/long-poll within Vercel's function time limits.
- **P4. Prisma 7 generator.** Consider migrating from `prisma-client-js` to the newer `prisma-client` generator, with an explicit `output`.
- ~~**P5. Leave is sent twice.**~~ Already resolved by B7 ([PR #9](https://github.com/arzljames/pulse-technical-assessment/pull/9)), which kept only `pagehide`.
- **Note:** S2 and S3 added a few more queries per poll (the rate-limit upsert and reaper bookkeeping), which makes P1 a bit more relevant as traffic grows.

**Feature follow-ups**

- **Sender-side blur for Safe Reveal.** Blur is applied by the viewer's browser, so a modified client (or DevTools) can remove it. Blurring frames before sending (canvas → `captureStream` → `replaceTrack`) makes it a real guarantee.
- **On-device NSFW guard** (the planned part 2 of Safe Reveal, skipped by choice).
- **TURN relay for "Hide my IP".** The code is done ([PR #28](https://github.com/arzljames/pulse-technical-assessment/pull/28)) but hidden until `TURN_URLS` and `TURN_SECRET` point at a relay ([PR #30](https://github.com/arzljames/pulse-technical-assessment/pull/30)). It needs a coturn server or a hosted TURN provider.
- **Stronger blocking.** The block list is per session id and in memory. A server-side anonymous report and rate limit would survive reloads.
- **UI/UX backlog** in 2.2: globe projection, dot clustering, sounds, toast stack, PWA manifest, and more.

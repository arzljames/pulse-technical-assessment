# Pulse — Notes

A short section per phase. Every change shipped in its own PR (numbers in brackets). The long version, with before/after code for each fix, is in [docs/FULL_NOTES.md](docs/FULL_NOTES.md).

---

## Phase 1 — Make it run

**How I found the bugs:** I traced the whole flow (join → poll → request → accept → WebRTC handshake → chat → video → end) through every API route and `lib/` module, asking at each step "what happens if this fails or runs out of order?" I confirmed each bug against a running dev server, using curl for the API.

**What was broken, and how I fixed it:**

| # | What was broken | How I found it | Fix | PR |
|---|---|---|---|---|
| B1 | Dots stayed on the map after people left | The README symptom pointed at stale presence. The reaper was correct, so I checked what keeps `lastSeen` fresh: the poll heartbeat updated **every** row | Heartbeat only the caller (`where: { id }`) | #3 |
| B2 | Chat messages never arrived | Traced send → receive: the sender used `t: "msg"`, the receiver expected `t: "chat"` | Send `t: "chat"` | #4 |
| B3 | Users stuck "busy" forever after a chat | The comment said `end` frees both peers, but no code handled `end` | `end` clears busy for both | #5 |
| B4 | Connections failed at random | The ICE candidate queue was flushed one line *before* the remote description was set | Set the description first, then flush | #6 |
| B5 | A missing Mapbox token gave a blank map, no hint | A hard-coded fake fallback token meant `!TOKEN` was never true | Remove the fallback | #7 |
| B6 | Closing the tab didn't end the chat for the other person | `leave` only deleted rows (including the peer's pending signals), and there was no data-channel `onclose` | Leave frees and notifies the peer, and the client treats channel close as a hang-up | #8 |
| B7 | Users silently vanished (background tabs, back button, failed join) | Asked "what recreates a presence row?" Nothing did | Poll returns `joined`, the client re-joins, `leave` skips bfcache | #9 |
| B8 | A busy user showed as free after auto-declining someone | Checked who can be busy whenever `decline` is sent | Decline no longer touches busy | #10 |
| B9 | "Connecting…" could hang forever | Checked every connection state for an exit; `connecting` had none | 20 s connect timeout, and stale accepts get `end` | #11 |
| B10 | Negotiation errors stalled calls silently | Searched for empty `catch {}` and `void`-ed promises | Errors handled and reported, so the UI recovers | #12 |
| B11 | Dots didn't move when a position changed | The map reconcile only updated opacity | Update the marker position too | #13 |
| B12 | Busy dots were clickable and showed a misleading "Request declined" | The click handler never checked the target's busy flag | Busy dots disabled, with an "In a conversation" tooltip | #14 |

Also fixed during Phase 2: chat was hidden during video (B16, #19), the online count was unclear (B17, #22), and the Geist font was overridden (B18, #15).

**Left for later (minor):** B13 overlapping notices, B14 a timer ref not nulled, B15 transceivers pile up across repeated video calls, B19 secure-context errors on plain-http LAN testing, B20 a leftover ngrok dev host, B21 setup docs say `db push` but the repo ships migrations.

---

## Phase 2 — Make it good

**What I changed:**
- **Landing (#15):** animated dotted globe, a bold "Find someone out there." hero, one clear Enter Pulse button, and privacy chips.
- **Chat panel (#16, #17):**
  - a side panel on desktop and a bottom sheet on mobile
  - message bubbles, 12-hour times and a typing indicator
  - the stranger's city and country in the header
  - skip and end buttons
- **Request prompts (#18):**
  - a countdown ring on every request
  - separate cards for incoming, outgoing, timed out, declined and expired
  - distance and approximate location of the stranger
  - video requests with a live camera preview
- **Video call (#19):**
  - full-stage video with a timer, mic and camera toggles, and a Show map mode
  - End video kept separate from End chat
  - chat stays open beside the video

**The thinking behind it:**
- **The globe is the product.** Every screen keeps the "talking to a dot somewhere on Earth" feeling: the landing globe, the map staying visible beside chat, and Show map during calls.
- **Make waiting and outcomes visible.** Countdowns show how long a request lasts. Outcome cards say *why* something ended (they declined, nobody answered, it expired) instead of a vague toast.
- **Text is the safety valve.** Video sits beside chat, never over it, so you can say "your audio is broken" without hanging up. Ending video drops you back to text with the same person.
- **One consistent system:** dark theme, one accent colour, the Geist font, mobile bottom sheets, and `prefers-reduced-motion`, focus rings and aria labels throughout.

---

## Phase 3 — Make it secure

**Issues found, ranked:**

| Rank | Issue | Severity | Status |
|---|---|---|---|
| S1 | No auth: every session id was public and was the only credential, so anyone could read, impersonate, kick or move another user | 🔴 Critical | ✅ #24 |
| S2 | Busy-flag DoS: forged `accept`/`end` could mark anyone busy or end anyone's chat | 🔴 Critical | ✅ #25 |
| S3 | No rate limiting: request spam, unlimited sessions, join/poll hammering | 🟠 High | ✅ #26 |
| S4 | Location scraping without joining, and repeated re-joins could be averaged to find someone's home | 🟠 High | ✅ #27 |
| S5 | Peer-to-peer WebRTC shows each stranger the other's IP address | 🟠 High | ✅ #28 (relay ready, switched off: #30) |
| S6 | Weak input validation: unlimited body sizes, any payload relayed, no limits on peer messages | 🟠 High | ✅ #29 |
| S7 | Database errors surface as unlogged 500s | 🟡 Medium | Not fixed |
| S8 | No security headers (CSP, Permissions-Policy, …) | 🟡 Medium | Not fixed |
| S9 | Mapbox token not restricted to the site's URL | 🟡 Medium | Not fixed (dashboard setting) |
| S10 | Unvalidated control messages between browsers | 🟡 Low | ✅ #29 |

**What I fixed:**
- **S1:** the server issues each session a public id plus a signed secret token, and every route takes the caller's identity from the token, never from the request.
- **S2:** the server tracks who requested whom and who is connected, and refuses signals that don't fit.
- **S3:** rate limits stored in Postgres, so they hold across serverless instances: sessions, joins, polls, signals, and 3 requests per 5 min to the same person.
- **S4:** no map data until you join. Dots snap to a fixed point in a ~2 km square, so averaging re-joins only finds the square.
- **S5:** an opt-in "Hide my IP" relay-only mode with short-lived TURN credentials. It's hidden until a relay server is configured.
- **S6:** body size caps, payload shape checks per signal type, a database enum, and size, length and flood limits on peer-to-peer messages (this also fixes S10).

**Why S7–S9 come next:** each is small. Restricting the token (S9) is a dashboard setting, and headers (S8) and error handling (S7) are quick hardening. They ranked below the fixes above, which closed real attacks.

---

## Phase 4 — Make it better

**What I built:**
- **Safe Reveal (#20, #23):**
  - video starts **fully blurred**
  - each person's **Reveal me** slider sets how clearly the *other* person sees them, with a "Stranger is revealing… 40%" chip
  - an eye button re-hides the stranger at any time
  - a **panic button** ends the chat, blocks the stranger, and puts you back as a new identity after a random 30–90 s delay, so the blocked person can't link your new dot to you
- **Floating live stats (#22):**
  - a draggable, minimizable panel with live totals and a per-continent breakdown
  - "dots near you" grouped by city, with search and distance/status filters

**Why:**
- **Safe Reveal** targets the biggest real-world risk of anonymous video chat: unwanted content the moment the camera turns on. Consent comes first, each person stays in control of their own image, and no video ever reaches the server.
- **Live stats** makes the globe feel alive. You can see how many people are out there, where they are, and who's nearby and free.

**What I'd do next with more time:**
- **Sender-side blur:** blur frames before sending them, so a modified client or DevTools can't remove the blur.
- **An on-device NSFW guard** (TensorFlow.js / NSFWJS) that re-blurs explicit frames automatically. It was planned and skipped by choice.
- **A TURN relay server**, so Hide my IP can be switched on.
- **Server-side anonymous reports**, so blocking survives reloads.
- **More "alive" touches:** animated arcs between connected dots, and a day/night layer.

---

## Setup notes

- **Schema:** S2 (`requestTo`, `peerId`), S3 (`RateLimit`) and S6 (`SignalType` enum) need `npx prisma db push` on the production database.
- **Env vars:** set `SESSION_SECRET` (32+ random characters) in production. `TURN_URLS` and `TURN_SECRET` are optional.
- **Still to do before shipping:** a full two-browser end-to-end test, S7–S9, and a fix for the request-modal line "They can't see yours until they accept" (every dot is public).

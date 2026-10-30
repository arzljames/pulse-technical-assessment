# Pulse — All Changes

A simple list of every change, by phase, with its PR. For the full write-up (how each issue was found, before/after code, trade-offs), see [NOTES.md](NOTES.md).

## Bug fixes (Phase 1)

15 bugs fixed: B1–B12 each in their own PR, B16–B18 as part of the UI work.

- **B1** — Polling now only refreshes your own dot, so closed tabs disappear from the map (PR #3)
- **B2** — Chat messages now actually reach the other person (wrong message tag) (PR #4)
- **B3** — Ending a chat frees both people instead of leaving them stuck as busy (PR #5)
- **B4** — Connection candidates are applied after the offer, so calls stop failing at random (PR #6)
- **B5** — Removed the fake Mapbox token, so a missing token shows a clear message (PR #7)
- **B6** — Closing the tab mid-chat now ends the chat for the other person too (PR #8)
- **B7** — You're put back on the map automatically if your dot was removed (PR #9)
- **B8** — Declining a request no longer marks a busy person as free (PR #10)
- **B9** — Stuck "Connecting…" now times out, and late accepts are rejected (PR #11)
- **B10** — Connection errors are handled instead of silently stalling (PR #12)
- **B11** — Dots move on the map when someone's position changes (PR #13)
- **B12** — Busy dots can't be clicked and say "In a conversation" (PR #14)
- **B16** — Chat stays visible during a video call (PR #19)
- **B17** — Online count includes you, and the stats panel splits busy from available (PR #22)
- **B18** — The Geist font now actually applies (PR #15)

## UI/UX revamp (Phase 2)

Four screens rebuilt to the provided designs, plus two small follow-ups.

- **Landing page** — Animated dotted globe, "Find someone out there." hero, Enter Pulse button, info chips (PR #15)
- **Enter Pulse pointer cursor** — Included in the landing PR (PR #15)
- **Chat panel** — Side panel on desktop, bottom sheet on mobile, bubbles, typing dots, skip and end buttons (PR #16)
- **Chat time and place** — 12-hour timestamps and the stranger's city and country in the header (PR #17)
- **Request prompts** — Countdown modals for outgoing, incoming, timed-out, declined and expired requests, plus video request cards with a camera preview (PR #18)
- **Video call** — Full video stage with timer, mic and camera toggles, Show map, End video, and chat kept open beside it (PR #19)

## Security revamp (Phase 3)

7 of the 10 security issues fixed (S1–S6 and S10).

- **S1 — Session tokens** — The server issues each user a secret token, so nobody can act as someone else just by knowing their id (PR #24)
- **S2 — Connection tracking** — The server remembers who requested and who is connected to whom, so fake accepts and ends are refused (PR #25)
- **S3 — Rate limiting** — Limits on sessions, joins, polls, signals and repeat requests to the same person; 16 KB payload cap (PR #26)
- **S4 — Location privacy** — No map data without joining, and dots snap to a fixed point in a ~2 km square so re-joins can't be averaged to find someone's home (PR #27)
- **S5 — IP exposure** — Optional "Hide my IP" relay mode with short-lived relay credentials (PR #28)
- **S6 — Input validation** — Request size caps, payload shape checks, a database enum for signal types, and limits on peer-to-peer messages (PR #29)
- **S10 — Control messages** — Only known control values are accepted between browsers (PR #29)

## New features (Phase 4)

Three features shipped, plus one switched off until a relay server exists.

- **Safe Reveal (safe video)** — Video starts fully blurred; each person's "Reveal me" slider sets how clearly the other sees them; an eye button re-hides the stranger; a panic button blocks the stranger and gives you a new identity (PR #20)
- **Stay hidden after panic** — After a panic you stay off the map until you tap Go back, then reappear after a random 30–90 s delay (PR #21, re-opened against main as PR #23)
- **Floating live stats** — Draggable, minimizable panel with totals, a per-continent breakdown, and nearby dots grouped by city with search and filters; online count moved to the top right (PR #22)
- **Hide my IP card switched off** — The landing-page switch only shows once a relay server is configured (PR #30)

## Setup and database changes

Schema changes were applied to the dev database with `npx prisma db push`; production still needs them.

- **Presence table** — Added `requestTo` and `peerId` columns (S2)
- **RateLimit table** — New table for rate-limit counters (S3)
- **Signal type** — Changed from text to a database enum (S6)
- **New env vars in `.env.example`** — `SESSION_SECRET` (required in production), `TURN_URLS` and `TURN_SECRET` (optional relay)
- **New API routes** — `/api/session` (start a session) and `/api/ice` (connection and relay settings)
- **Notes** — `NOTES.md` (full write-up) and this simplified list

## Still to do

Urgent items first; the rest can wait for a future pass.

**Urgent**

- [ ] Set `SESSION_SECRET` in Vercel (the app can't start sessions in production without it)
- [ ] Add a migration for the S2, S3 and S6 schema changes, or document `db push`, and apply them to the production database
- [ ] Run a full two-browser test of chat, video, reveal, panic, skip and stats
- [ ] Restrict the Mapbox token to the site's URL (S9)
- [ ] Add error handling and logging to the API routes (S7)
- [ ] Add security headers (S8)
- [ ] Fix the request-modal wording "They can't see yours until they accept"
- [ ] Deploy to Vercel

**Future**

- [ ] Minor bugs B13, B14, B15, B19, B20
- [ ] Lighter polling and missing indexes (P1–P4)
- [ ] Sender-side blur for Safe Reveal
- [ ] On-device NSFW guard
- [ ] A TURN relay server for Hide my IP
- [ ] Stronger blocking with server-side reports

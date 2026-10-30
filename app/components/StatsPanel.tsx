"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CONTINENTS, continentOf } from "@/lib/continents";
import { distanceKm, formatDistance } from "@/lib/geo";
import { reverseGeocode, type Place } from "@/lib/geocode";
import type { PeerDot } from "@/lib/types";
import { LockIcon, PersonIcon } from "./icons";

// Floating live stats: totals, a per-continent breakdown and the dots near
// you. Draggable by its header (or the whole pill when minimized); position
// and minimized state persist in localStorage.

type Pos = { x: number; y: number };
type Range = 5 | 25 | 100 | null; // km, null = any distance
type Status = "all" | "available" | "busy";

const STORAGE_KEY = "pulse.stats";
const MARGIN = 12;
const PANEL_W = 300;
const PILL_W = 230;
const PILL_H = 44;
// Lowest the panel's top may sit, so its header stays reachable.
const PANEL_MIN_VISIBLE = 160;
// Reverse-geocode at most this many nearby dots (one Mapbox call each,
// cached per ~1 km cell).
const GEOCODE_LIMIT = 40;
// A drag that moves less than this is a click (expands the pill).
const CLICK_SLOP = 4;
const AVATAR_COLORS = ["text-ember", "text-live", "text-accent", "text-violet-300"];

const fmt = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

// Short, stable label from a session id ("Dot · 4F2A"). Hashed so the label
// never reveals characters of the real id.
function dotLabel(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).slice(-4).toUpperCase().padStart(4, "0");
}

function formatSince(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h`;
}

function load(): { pos: Pos; minimized: boolean } | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (
      typeof v?.pos?.x === "number" &&
      typeof v?.pos?.y === "number" &&
      typeof v?.minimized === "boolean"
    ) {
      return v;
    }
  } catch {}
  return null;
}

function save(pos: Pos, minimized: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ pos, minimized }));
  } catch {}
}

export default function StatsPanel({
  peers,
  me,
  canConnect,
  onConnect,
}: {
  peers: PeerDot[];
  me: { lat: number; lng: number } | null;
  canConnect: boolean;
  onConnect: (peerId: string) => void;
}) {
  const [saved] = useState(load);
  const [pos, setPos] = useState<Pos>(saved?.pos ?? { x: MARGIN, y: MARGIN });
  // Phones start minimized so the map isn't covered.
  const [minimized, setMinimized] = useState(
    () => saved?.minimized ?? window.innerWidth < 640,
  );
  const [viewport, setViewport] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));
  const [now, setNow] = useState(() => Date.now());

  const [query, setQuery] = useState("");
  const [range, setRange] = useState<Range>(null);
  const [status, setStatus] = useState<Status>("all");
  const [places, setPlaces] = useState<Record<string, Place | null>>({});

  // When each dot entered its current status, for "available · 2 min".
  // Derived during render when `peers` changes (React's pattern for state
  // that depends on props).
  const [since, setSince] = useState<{
    peers: PeerDot[];
    map: Map<string, { busy: boolean; at: number }>;
  }>({ peers: [], map: new Map() });
  if (since.peers !== peers) {
    const map = new Map<string, { busy: boolean; at: number }>();
    for (const p of peers) {
      const prev = since.map.get(p.id);
      map.set(p.id, prev && prev.busy === p.busy ? prev : { busy: p.busy, at: now });
    }
    setSince({ peers, map });
  }

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    const onResize = () =>
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => {
      clearInterval(tick);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Keep the panel on screen whatever the window size or saved position.
  const width = Math.min(minimized ? PILL_W : PANEL_W, viewport.w - 2 * MARGIN);
  const maxY = viewport.h - (minimized ? PILL_H : PANEL_MIN_VISIBLE) - MARGIN;
  const x = Math.max(MARGIN, Math.min(pos.x, viewport.w - width - MARGIN));
  const y = Math.max(MARGIN, Math.min(pos.y, maxY));

  // ── Dragging ─────────────────────────────────────────────────────────────
  const drag = useRef<{
    px: number;
    py: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLElement>) {
    // Buttons inside the handle (minimize) keep working as buttons.
    if (!minimized && (e.target as HTMLElement).closest("button")) return;
    if (e.button !== 0) return;
    drag.current = { px: e.clientX, py: e.clientY, x, y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    d.moved = true;
    setPos({ x: d.x + dx, y: d.y + dy });
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) save({ x, y }, minimized);
    else if (minimized) toggle(false);
  }

  // Arrow keys move the panel too, for keyboard users.
  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    const step = e.shiftKey ? 64 : 16;
    const delta: Record<string, Pos> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const d = delta[e.key];
    if (d) {
      e.preventDefault();
      const next = { x: x + d.x, y: y + d.y };
      setPos(next);
      save(next, minimized);
    } else if (minimized && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      toggle(false);
    }
  }

  function toggle(next: boolean) {
    setMinimized(next);
    save({ x, y }, next);
  }

  const dragProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onKeyDown,
  };

  // ── Stats ────────────────────────────────────────────────────────────────
  const total = peers.length + (me ? 1 : 0);
  const busy = peers.filter((p) => p.busy).length;
  const available = total - busy;

  const byContinent = useMemo(() => {
    const counts = new Map<string, number>(CONTINENTS.map((c) => [c, 0]));
    const all = me ? [...peers, me] : peers;
    for (const p of all) {
      const c = continentOf(p.lat, p.lng);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [peers, me]);
  const maxCount = Math.max(1, ...byContinent.map(([, n]) => n));

  // Dots within 100 km, nearest first.
  const nearby = useMemo(() => {
    if (!me) return [];
    return peers
      .map((p) => ({ peer: p, km: distanceKm(me, p) }))
      .filter((d) => d.km <= 100)
      .sort((a, b) => a.km - b.km);
  }, [peers, me]);

  useEffect(() => {
    let cancelled = false;
    for (const { peer } of nearby.slice(0, GEOCODE_LIMIT)) {
      const key = `${peer.lat},${peer.lng}`;
      void reverseGeocode(peer.lat, peer.lng).then((place) => {
        if (!cancelled) {
          setPlaces((prev) => (key in prev ? prev : { ...prev, [key]: place }));
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [nearby]);

  const q = query.trim().toLowerCase();
  const shown = nearby.filter(({ peer, km }) => {
    if (range !== null && km > range) return false;
    if (status === "available" && peer.busy) return false;
    if (status === "busy" && !peer.busy) return false;
    if (q) {
      const place = places[`${peer.lat},${peer.lng}`];
      const text = [place?.name, place?.region, place?.country]
        .join(" ")
        .toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  // Grouped by place, groups in order of their nearest dot.
  const groups: { name: string; dots: typeof shown }[] = [];
  for (const d of shown) {
    const name = places[`${d.peer.lat},${d.peer.lng}`]?.name ?? "Nearby";
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, dots: [] }));
    g.dots.push(d);
  }

  // ── Minimized pill ───────────────────────────────────────────────────────
  if (minimized) {
    const faces = (nearby.length ? nearby.map((d) => d.peer) : peers).slice(0, 4);
    const rest = total - faces.length;
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`${fmt.format(total)} live. Expand stats (drag or arrow keys to move)`}
        {...dragProps}
        style={{ left: x, top: y }}
        className="absolute z-10 flex h-11 cursor-grab touch-none select-none items-center gap-2.5 rounded-full border border-line bg-ink/90 pl-3.5 pr-2 shadow-2xl backdrop-blur-xl active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-live" />
        <span className="text-sm font-bold tabular-nums">{fmt.format(total)}</span>
        <span className="font-mono text-[10px] font-semibold tracking-wider text-zinc-400">
          LIVE
        </span>
        {faces.length > 0 && (
          <span className="flex items-center gap-1 border-l border-line pl-2.5">
            {faces.map((p, i) => (
              <span
                key={p.id}
                className={`flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface ${AVATAR_COLORS[i]}`}
              >
                <PersonIcon size={12} />
              </span>
            ))}
          </span>
        )}
        {rest > 0 && (
          <span className="rounded-full bg-surface px-2 py-0.5 font-mono text-[11px] text-zinc-300">
            +{compact.format(rest).toLowerCase()}
          </span>
        )}
      </div>
    );
  }

  // ── Expanded panel ───────────────────────────────────────────────────────
  return (
    <section
      aria-label="Live stats"
      style={{ left: x, top: y, width, maxHeight: viewport.h - y - MARGIN }}
      className="modal-in absolute z-10 flex flex-col overflow-hidden rounded-2xl border border-line bg-ink/92 shadow-2xl backdrop-blur-xl"
    >
      <div
        tabIndex={0}
        aria-label="Move stats panel (drag or arrow keys)"
        {...dragProps}
        className="cursor-grab touch-none select-none px-4 pt-3.5 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"
      >
        <div className="flex items-center gap-2">
          <span className="live-blink h-1.5 w-1.5 rounded-full bg-live" />
          <span className="font-mono text-[10px] font-semibold tracking-wider text-live">
            LIVE NOW
          </span>
          <span className="ml-auto font-mono text-[10px] text-zinc-500">
            updates every few sec
          </span>
          <button
            onClick={() => toggle(true)}
            aria-label="Minimize stats"
            title="Minimize"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-zinc-400 transition hover:text-white"
          >
            <MinimizeIcon />
          </button>
        </div>

        <div className="mt-2 flex items-end justify-between gap-3 pb-3">
          <div>
            <p className="text-4xl font-bold leading-none tracking-tight tabular-nums">
              {fmt.format(total)}
            </p>
            <p className="mt-1.5 text-[11px] text-zinc-500">active dots across the globe</p>
          </div>
          <div className="flex shrink-0 gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-1.5 text-center">
            <div>
              <p className="text-sm font-bold tabular-nums">{fmt.format(busy)}</p>
              <p className="text-[10px] text-zinc-500">in a chat</p>
            </div>
            <div>
              <p className="text-sm font-bold tabular-nums text-live">
                {fmt.format(available)}
              </p>
              <p className="text-[10px] text-zinc-500">available</p>
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="space-y-1.5 px-4 pb-4">
          {byContinent.map(([name, n]) => (
            <li key={name} className="flex items-center gap-3 text-[11px]">
              <span className="w-24 shrink-0 text-zinc-300">{name}</span>
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-800">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${(n / maxCount) * 100}%` }}
                />
              </span>
              <span className="w-12 text-right font-mono tabular-nums text-zinc-300">
                {fmt.format(n)}
              </span>
            </li>
          ))}
        </ul>

        <div className="border-t border-line px-4 pt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Dots near you</h2>
            <span className="font-mono text-[11px] text-zinc-500">
              {shown.length} of {nearby.length}
            </span>
          </div>

          <label className="mt-3 flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3 focus-within:border-accent/60">
            <SearchIcon />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a city or area…"
              aria-label="Search a city or area"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-zinc-500"
            />
          </label>

          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Distance">
            {([5, 25, 100, null] as Range[]).map((r) => (
              <Chip key={String(r)} on={range === r} onClick={() => setRange(r)}>
                {r === null ? "Any" : `≤ ${r} km`}
              </Chip>
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Status">
            {(
              [
                ["all", "All"],
                ["available", "Available"],
                ["busy", "In a chat"],
              ] as const
            ).map(([s, label]) => (
              <Chip key={s} on={status === s} onClick={() => setStatus(s)}>
                {label}
              </Chip>
            ))}
          </div>
        </div>

        <div className="space-y-4 px-4 py-4">
          {!me ? (
            <p className="text-center text-xs text-zinc-500">
              Your location isn&rsquo;t set.
            </p>
          ) : groups.length === 0 ? (
            <p className="text-center text-xs text-zinc-500">
              {nearby.length === 0 ? "No one within 100 km yet." : "No dots match."}
            </p>
          ) : (
            groups.map((g) => (
              <div key={g.name}>
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-zinc-300">{g.name}</span>
                  <span className="font-mono text-zinc-500">
                    {g.dots.length} {g.dots.length === 1 ? "dot" : "dots"}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {g.dots.map(({ peer, km }) => {
                    const at = since.map.get(peer.id)?.at ?? now;
                    return (
                      <li
                        key={peer.id}
                        className="flex items-center gap-2.5 rounded-xl border border-line bg-surface p-2"
                      >
                        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ember/30 bg-ember/10 text-ember">
                          <PersonIcon size={16} />
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${
                              peer.busy ? "bg-amber-400" : "bg-live"
                            }`}
                          />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-[11px] font-semibold">
                            Dot · {dotLabel(peer.id)}
                          </p>
                          <p className="truncate text-[10px] text-zinc-500">
                            {formatDistance(km)} ·{" "}
                            {peer.busy ? "in a chat" : "available"} ·{" "}
                            {formatSince(Math.max(0, now - at))}
                          </p>
                        </div>
                        {peer.busy ? (
                          <span className="rounded-lg px-2.5 py-1 text-[11px] text-zinc-500">
                            Busy
                          </span>
                        ) : (
                          <button
                            onClick={() => onConnect(peer.id)}
                            disabled={!canConnect}
                            className="h-7 shrink-0 cursor-pointer rounded-lg bg-accent px-2.5 text-[11px] font-semibold text-ink transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Connect
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>

      <p className="flex items-center gap-1.5 border-t border-line px-3.5 py-2.5 text-[9.5px] text-zinc-500">
        <LockIcon size={10} /> Locations are fuzzed to a ~2 km area. No names, ever.
      </p>
    </section>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`h-7 cursor-pointer rounded-full border px-2.5 text-[11px] font-medium transition ${
        on
          ? "border-accent bg-accent text-ink"
          : "border-line bg-surface text-zinc-300 hover:border-zinc-600"
      }`}
    >
      {children}
    </button>
  );
}

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function MinimizeIcon() {
  return (
    <svg {...iconProps} width={13} height={13}>
      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg {...iconProps} width={14} height={14} className="shrink-0 text-zinc-500">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

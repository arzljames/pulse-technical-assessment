"use client";

import { useEffect, useId, useRef } from "react";
import { formatCountdown, useCountdown } from "@/lib/useCountdown";
import { LockIcon, PersonIcon, PinIcon } from "./icons";

// One card for every step of a connection request, on both sides:
//   outgoing  — I tapped a dot and I'm waiting        (countdown, Cancel)
//   incoming  — someone tapped me                     (countdown, Decline/Accept)
//   timeout   — my request got no answer              (Back / Try again)
//   declined  — they said no                          (Back / Find someone else)
//   expired   — I didn't answer in time               (Back)
export type RequestModalKind =
  | "outgoing"
  | "incoming"
  | "timeout"
  | "declined"
  | "expired";

interface Copy {
  eyebrow: string;
  title: string;
  body: string;
  timeLabel: string;
  note: string;
  live: boolean; // countdown running?
}

const NOTE_REQUEST = "Locations are fuzzed to a ~2 km area. They can't see yours until they accept.";
const NOTE_ACCEPT = "Locations are fuzzed to a ~2 km area. Accepting opens a private peer-to-peer chat.";

function copyFor(kind: RequestModalKind, nearby: boolean): Copy {
  switch (kind) {
    case "outgoing":
      return {
        eyebrow: "Waiting for response",
        title: "Requesting to connect",
        body: `We've pinged an anonymous stranger${nearby ? " nearby" : ""}. Hang tight while they decide.`,
        timeLabel: "Time left",
        note: NOTE_REQUEST,
        live: true,
      };
    case "incoming":
      return {
        eyebrow: "Incoming request",
        title: "A stranger wants to connect",
        body: "Someone tapped your dot. Accept to start a private chat.",
        timeLabel: "Auto-decline in",
        note: NOTE_ACCEPT,
        live: true,
      };
    case "timeout":
      return {
        eyebrow: "No response",
        title: "Request timed out",
        body: "They didn't answer in time. Try again or pick someone else on the map.",
        timeLabel: "Time left",
        note: NOTE_REQUEST,
        live: false,
      };
    case "declined":
      return {
        eyebrow: "Declined",
        title: "Not this time",
        body: "They passed on the request. Plenty of other dots out there.",
        timeLabel: "Time left",
        note: NOTE_REQUEST,
        live: false,
      };
    case "expired":
      return {
        eyebrow: "Missed",
        title: "Request expired",
        body: "You didn't respond in time, so it was declined automatically.",
        timeLabel: "Auto-decline in",
        note: NOTE_ACCEPT,
        live: false,
      };
  }
}

export default function RequestModal({
  kind,
  location,
  distance,
  distanceKmValue,
  deadline,
  totalMs,
  onPrimary,
  onSecondary,
}: {
  kind: RequestModalKind;
  location: string | null; // "Near Davao City, Philippines"
  distance: string | null; // "~2 km"
  distanceKmValue: number | null;
  deadline: number | null; // epoch ms, for live kinds
  totalMs: number;
  // Primary = filled button (Accept / Try again / Find someone else).
  // Secondary = outline button (Cancel / Decline / Back to map).
  onPrimary?: () => void;
  onSecondary: () => void;
}) {
  const nearby = distanceKmValue !== null && distanceKmValue < 50;
  const c = copyFor(kind, nearby);
  const msLeft = useCountdown(c.live ? deadline : null);
  const progress = c.live ? msLeft / totalMs : 0;
  const titleId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const secondaryRef = useRef<HTMLButtonElement>(null);

  // Focus the likely next action; Esc = the outline button (cancel / back).
  useEffect(() => {
    (primaryRef.current ?? secondaryRef.current)?.focus();
  }, [kind]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSecondary();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSecondary]);

  const accentRing = kind === "incoming";
  const secondaryLabel =
    kind === "outgoing" ? "Cancel request" : kind === "incoming" ? "Decline" : "Back to map";
  const primaryLabel =
    kind === "incoming"
      ? "Accept"
      : kind === "timeout"
        ? "Try again"
        : kind === "declined"
          ? "Find someone else"
          : null;

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/55 p-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal-in w-full max-w-[360px] rounded-3xl border border-line bg-[#0f1219]/95 p-6 text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl"
      >
        <CountdownAvatar progress={progress} live={c.live} accent={accentRing} />

        <p
          className={`mt-4 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] ${
            c.live ? (accentRing ? "text-accent" : "text-ember") : "text-zinc-500"
          }`}
        >
          {c.eyebrow}
        </p>
        <h2 id={titleId} className="mt-1.5 text-xl font-bold tracking-tight">
          {c.title}
        </h2>
        <p className="mx-auto mt-1.5 max-w-[280px] text-[13px] leading-relaxed text-zinc-400">
          {c.body}
        </p>

        <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-[#141822] text-left">
          <div className="flex items-center gap-3 px-3.5 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-accent">
              <PinIcon />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] text-zinc-500">Approximate location</p>
              <p className="truncate text-sm font-semibold">
                {location ?? "Somewhere out there"}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-line">
            <Stat label="Distance" value={distance ?? "—"} />
            <Stat
              label={c.timeLabel}
              value={c.live ? formatCountdown(msLeft) : "—"}
              border
            />
          </div>
        </div>

        <p className="mt-4 flex items-start justify-center gap-1.5 px-2 text-[11px] leading-snug text-zinc-500">
          <span className="mt-0.5 shrink-0">
            <LockIcon />
          </span>
          {c.note}
        </p>

        <div className={`mt-5 grid gap-2.5 ${primaryLabel ? "grid-cols-2" : "grid-cols-1"}`}>
          <button
            ref={secondaryRef}
            onClick={onSecondary}
            className="h-11 cursor-pointer rounded-xl border border-line bg-surface text-sm font-semibold text-zinc-200 transition hover:border-zinc-600 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1219]"
          >
            {secondaryLabel}
          </button>
          {primaryLabel && onPrimary && (
            <button
              ref={primaryRef}
              onClick={onPrimary}
              className="h-11 cursor-pointer rounded-xl bg-accent text-sm font-semibold text-ink transition hover:bg-accent-strong outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f1219]"
            >
              {primaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, border }: { label: string; value: string; border?: boolean }) {
  return (
    <div className={`px-3.5 py-2.5 ${border ? "border-l border-line" : ""}`}>
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="font-mono text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

// Avatar tile inside a ring; while live, an arc drains as time runs out.
function CountdownAvatar({
  progress,
  live,
  accent,
}: {
  progress: number;
  live: boolean;
  accent: boolean;
}) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const stroke = accent ? "var(--color-accent)" : "var(--color-ember)";
  return (
    <div className="relative mx-auto h-20 w-20">
      <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={r} fill="none" stroke="#1d2030" strokeWidth="3" />
        {live && (
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - progress)}
            className="transition-[stroke-dashoffset] duration-300 ease-linear"
          />
        )}
      </svg>
      <div
        className={`absolute inset-3 flex items-center justify-center rounded-2xl border ${
          live
            ? "border-ember/30 bg-ember/10 text-ember"
            : "border-line bg-[#1a1712] text-ember/70"
        }`}
      >
        <PersonIcon size={22} />
      </div>
    </div>
  );
}

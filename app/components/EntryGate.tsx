"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import DotGlobe from "./DotGlobe";

const rise = (ms: number) =>
  ({ "--rise-delay": `${ms}ms` }) as CSSProperties;

export default function EntryGate({
  onReady,
}: {
  onReady: (lat: number, lng: number) => void;
}) {
  const [status, setStatus] = useState<"idle" | "locating" | "error">("idle");
  const [error, setError] = useState<string>("");

  function enter() {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setError("Your browser doesn't support location access.");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => onReady(pos.coords.latitude, pos.coords.longitude),
      (err) => {
        setStatus("error");
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission is required to place you on the map."
            : "Couldn't get your location. Please try again.",
        );
      },
      // High accuracy + maximumAge:0 forces a fresh fix (Wi-Fi/GPS scan)
      // instead of reusing the browser's cached IP-based location.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  const locating = status === "locating";

  return (
    <div className="relative isolate flex min-h-dvh flex-1 flex-col overflow-hidden bg-ink text-foreground">
      {/* Globe, with a bottom fade so it sinks into the page. */}
      <DotGlobe className="pointer-events-none absolute inset-0 -z-10 h-full w-full" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-ink to-transparent"
      />

      <header className="rise mx-auto flex w-full max-w-5xl items-center justify-between px-6 pt-6 sm:pt-8">
        <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_10px_2px_rgba(143,162,255,0.6)]" />
          Pulse
        </span>
        <span className="hidden font-mono text-[11px] tracking-[0.14em] text-accent/80 sm:inline">
          PEER-TO-PEER · WEBRTC
        </span>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 pb-24 pt-12 text-center">
        <p
          className="rise inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1 text-xs text-zinc-400 backdrop-blur"
          style={rise(80)}
        >
          <span className="live-blink h-1.5 w-1.5 rounded-full bg-live" />
          Anonymous strangers, live on the map
        </p>

        <h1
          className="rise mt-7 text-[clamp(3.25rem,11vw,7rem)] font-bold leading-[0.92] tracking-[-0.045em]"
          style={rise(160)}
        >
          Find
          <br />
          someone
          <br />
          out there.
        </h1>

        <p
          className="rise mt-7 max-w-md text-[15px] leading-relaxed text-zinc-400"
          style={rise(260)}
        >
          A living globe of anonymous strangers. Drop onto the map, see
          who&rsquo;s nearby, and start talking — no account, no history.
        </p>

        <div className="rise mt-8" style={rise(340)}>
          <button
            onClick={enter}
            disabled={locating}
            className="group inline-flex items-center gap-3 rounded-full bg-accent py-2 pl-6 pr-2 text-sm font-semibold text-ink shadow-[0_0_40px_-8px_rgba(143,162,255,0.7)] transition hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-80"
          >
            {locating ? "Locating you…" : "Enter Pulse"}
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-accent transition group-hover:translate-x-0.5">
              {locating ? <Spinner /> : <ArrowIcon />}
            </span>
          </button>
        </div>

        <div
          role="alert"
          aria-live="polite"
          className="mt-4 min-h-5 max-w-sm text-sm text-rose-300"
        >
          {status === "error" && error}
        </div>

        <ul
          className="rise mt-2 flex flex-wrap justify-center gap-2"
          style={rise(420)}
        >
          <Chip icon={<PersonIcon />}>No sign-up</Chip>
          <Chip icon={<PinIcon />}>Dot placed 1–3 km from you</Chip>
          <Chip icon={<LockIcon />}>Nothing stored</Chip>
        </ul>
      </main>

      <footer
        className="rise pb-6 text-center font-mono text-[11px] tracking-wide text-zinc-500"
        style={rise(520)}
      >
        Close the tab and everything ends.
      </footer>
    </div>
  );
}

function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface/80 px-2.5 py-1.5 text-xs text-zinc-300 backdrop-blur">
      <span className="text-zinc-400">{icon}</span>
      {children}
    </li>
  );
}

// Inline icons — 14px, stroke-based, inherit currentColor.
const iconProps = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function ArrowIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg {...iconProps}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg {...iconProps} className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.2-8.56" />
    </svg>
  );
}

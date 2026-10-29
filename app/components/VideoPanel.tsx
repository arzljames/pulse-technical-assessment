"use client";

import { useEffect, useRef, useState } from "react";
import {
  CameraIcon,
  CameraOffIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MapIcon,
  MicIcon,
  MicOffIcon,
  PersonIcon,
  VideoOffIcon,
} from "./icons";

// Live video call. Occupies the space left of the chat panel (desktop) or
// above the chat sheet (mobile), so text chat keeps working during a call.
//
// "Show map" hides the stage to reveal the map, shrinking the stranger's
// video into a floating tile. The same <video> elements stay mounted in both
// modes, so audio never cuts out when toggling.
//
// Safe Reveal: both feeds start fully blurred. Each person's slider sets how
// clearly the *other* side sees them (the level travels over the data
// channel), and either side can re-hide the stranger at any time.

const MAX_BLUR_PX = 40;

function blurFor(level: number): string {
  const px = Math.round((1 - level) * MAX_BLUR_PX);
  return px > 0 ? `blur(${px}px)` : "none";
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm.slice(-2)}:${ss}` : `${mm}:${ss}`;
}

export default function VideoPanel({
  localStream,
  remoteStream,
  peerLabel,
  startedAt,
  micOn,
  camOn,
  onToggleMic,
  onToggleCam,
  onEnd,
  myReveal,
  peerReveal,
  onReveal,
}: {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  peerLabel: string; // "Stranger · Cagayan de Oro"
  startedAt: number;
  micOn: boolean;
  camOn: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onEnd: () => void;
  myReveal: number; // 0 = fully blurred, 1 = clear; how the stranger sees me
  peerReveal: number; // how clearly the stranger lets me see them
  onReveal: (level: number) => void;
}) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const [mapMode, setMapMode] = useState(false);
  // Receiver-side override: keep the stranger blurred whatever they reveal.
  const [hideRemote, setHideRemote] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (localRef.current && localRef.current.srcObject !== localStream) {
      localRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteRef.current && remoteRef.current.srcObject !== remoteStream) {
      remoteRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const elapsed = formatElapsed(Math.max(0, now - startedAt));
  const remoteFilter = hideRemote ? blurFor(0) : blurFor(peerReveal);
  const peerPct = Math.round(peerReveal * 100);
  const myPct = Math.round(myReveal * 100);

  return (
    <section
      aria-label="Video call"
      className={`absolute inset-x-0 top-0 bottom-[55dvh] z-20 transition-colors duration-300 sm:bottom-0 sm:right-[400px] ${
        mapMode ? "pointer-events-none bg-transparent" : "bg-[#07080c]"
      }`}
    >
      {/* Remote video: fills the stage, or floats as a tile in map mode. */}
      <div
        className={`pointer-events-auto absolute overflow-hidden transition-all duration-300 ${
          mapMode
            ? "left-3 top-14 h-28 w-44 rounded-2xl border border-line shadow-2xl sm:left-4 sm:top-16 sm:h-36 sm:w-60"
            : "inset-0"
        }`}
      >
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          style={{ filter: remoteFilter }}
          className="reveal-blur h-full w-full bg-[#07080c] object-cover"
        />
        {remoteStream && !mapMode && (hideRemote || peerReveal < 1) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <div
              role="status"
              className="pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-ink/80 px-3.5 py-2 text-xs text-zinc-200 backdrop-blur"
            >
              {hideRemote ? (
                <>
                  <EyeOffIcon size={14} />
                  You hid their video
                  <button
                    onClick={() => setHideRemote(false)}
                    className="cursor-pointer rounded-full bg-[#1a1d27] px-2.5 py-0.5 font-semibold text-accent hover:bg-[#232735]"
                  >
                    Show
                  </button>
                </>
              ) : peerPct === 0 ? (
                <>
                  <EyeOffIcon size={14} />
                  Stranger hasn&rsquo;t revealed yet
                </>
              ) : (
                <>
                  <EyeIcon size={14} />
                  Stranger is revealing… {peerPct}%
                </>
              )}
            </div>
          </div>
        )}
        {!remoteStream && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#07080c]">
            <div
              className={`flex items-center justify-center rounded-3xl border border-ember/30 bg-ember/10 text-ember ${
                mapMode ? "h-12 w-12" : "h-24 w-24"
              }`}
            >
              <PersonIcon size={mapMode ? 22 : 40} />
            </div>
            {!mapMode && (
              <p className="text-xs text-zinc-500">Waiting for stranger&rsquo;s video…</p>
            )}
          </div>
        )}
      </div>

      {/* Top bar: live timer + who, and the privacy badge. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2 sm:inset-x-4 sm:top-4">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-full border border-line bg-ink/80 px-3 py-1.5 text-xs backdrop-blur">
          <span className="live-blink h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
          <span className="font-mono font-semibold tabular-nums" aria-label="Call duration">
            {elapsed}
          </span>
          <span className="h-3 w-px bg-line" />
          <span className="truncate text-zinc-300">{peerLabel}</span>
        </div>
        <span className="pointer-events-auto hidden shrink-0 items-center gap-1.5 rounded-full border border-line bg-ink/80 px-3 py-1.5 font-mono text-[11px] text-zinc-300 backdrop-blur sm:inline-flex">
          <LockIcon /> Peer-to-peer
        </span>
      </div>

      {/* Self view (always floating, mirrored like a mirror). */}
      <div className="pointer-events-auto absolute right-3 top-14 h-24 w-18 overflow-hidden rounded-2xl border border-line bg-[#141822] shadow-2xl sm:bottom-24 sm:right-4 sm:top-auto sm:h-32 sm:w-44">
        <video
          ref={localRef}
          autoPlay
          playsInline
          muted
          // Blurred exactly as the stranger sees you.
          style={{ filter: blurFor(myReveal) }}
          className={`reveal-blur h-full w-full -scale-x-100 object-cover ${camOn ? "" : "invisible"}`}
        />
        {!camOn && (
          <div className="absolute inset-0 flex items-center justify-center text-zinc-500">
            <PersonIcon size={24} />
          </div>
        )}
        <span className="absolute bottom-1.5 left-1.5 rounded-md bg-ink/80 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-200">
          You{myPct < 100 && ` · ${myPct}%`}
        </span>
        {!micOn && (
          <span
            className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500/90 text-white"
            aria-label="Your microphone is muted"
          >
            <MicOffIcon size={11} />
          </span>
        )}
      </div>

      {/* Reveal slider + controls. */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-3 flex flex-col items-center gap-2 px-3 sm:bottom-5">
        <label className="flex w-full max-w-xs items-center gap-3 rounded-2xl border border-line bg-ink/85 px-3.5 py-2 text-xs shadow-2xl backdrop-blur-xl">
          <EyeIcon size={14} />
          <span className="shrink-0 font-semibold text-zinc-200">Reveal me</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={myPct}
            onChange={(e) => onReveal(Number(e.target.value) / 100)}
            aria-valuetext={myPct === 0 ? "Fully blurred" : `${myPct}% revealed`}
            className="min-w-0 flex-1 cursor-pointer accent-accent"
          />
          <span className="w-9 text-right font-mono tabular-nums text-zinc-400">
            {myPct}%
          </span>
        </label>
        <div className="flex items-center gap-1.5 rounded-2xl border border-line bg-ink/85 p-1.5 shadow-2xl backdrop-blur-xl">
          <ControlButton
            onClick={onToggleMic}
            active={micOn}
            label={micOn ? "Mute microphone" : "Unmute microphone"}
          >
            {micOn ? <MicIcon /> : <MicOffIcon />}
          </ControlButton>
          <ControlButton
            onClick={onToggleCam}
            active={camOn}
            label={camOn ? "Turn camera off" : "Turn camera on"}
          >
            {camOn ? <CameraIcon /> : <CameraOffIcon />}
          </ControlButton>
          <ControlButton
            onClick={() => setHideRemote((h) => !h)}
            active={!hideRemote}
            label={hideRemote ? "Show stranger's video" : "Hide stranger's video"}
          >
            {hideRemote ? <EyeOffIcon /> : <EyeIcon />}
          </ControlButton>
          <button
            onClick={() => setMapMode((m) => !m)}
            aria-pressed={mapMode}
            className="flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-[#1a1d27] px-3.5 text-sm font-semibold text-zinc-100 transition hover:bg-[#232735]"
          >
            <MapIcon />
            <span className="hidden sm:inline">{mapMode ? "Show video" : "Show map"}</span>
          </button>
          <button
            onClick={onEnd}
            className="flex h-10 cursor-pointer items-center gap-2 rounded-xl bg-[#d63a3a] px-3.5 text-sm font-semibold text-white transition hover:bg-[#e04a4a]"
          >
            <VideoOffIcon />
            End video
          </button>
        </div>
      </div>
    </section>
  );
}

function ControlButton({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={!active}
      title={label}
      className={`flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl transition ${
        active
          ? "bg-[#1a1d27] text-zinc-100 hover:bg-[#232735]"
          : "bg-red-500/20 text-red-300 hover:bg-red-500/30"
      }`}
    >
      {children}
    </button>
  );
}

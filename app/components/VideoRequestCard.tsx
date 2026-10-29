"use client";

import { useEffect, useRef } from "react";
import { formatCountdown, useCountdown } from "@/lib/useCountdown";
import {
  CameraIcon,
  CameraOffIcon,
  LockIcon,
  MicIcon,
  MicOffIcon,
  PersonIcon,
  XIcon,
} from "./icons";

// Inline cards shown in the chat panel, above the composer, while a video
// call is being negotiated:
//   incoming — the stranger asked; I can Decline / Accept before it expires.
//   outgoing — I asked; my camera preview is live (only I can see it) while
//              I wait, with mic/camera toggles and Cancel.

export function IncomingVideoCard({
  deadline,
  totalMs,
  onAccept,
  onDecline,
}: {
  deadline: number;
  totalMs: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const msLeft = useCountdown(deadline);
  return (
    <div
      role="alertdialog"
      aria-label="Incoming video call"
      className="msg-in rounded-2xl border border-line bg-[#11141c] p-3.5"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/40 bg-accent/10 text-accent">
          <CameraIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Incoming video call
          </p>
          <p className="text-sm font-semibold leading-tight">
            Stranger wants to turn on video
          </p>
        </div>
        <span className="font-mono text-xs font-semibold tabular-nums text-zinc-300">
          {formatCountdown(msLeft)}
        </span>
      </div>

      <ProgressBar value={msLeft / totalMs} className="bg-accent" />

      <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-snug text-zinc-500">
        <span className="mt-0.5 shrink-0">
          <LockIcon />
        </span>
        Your camera stays off until you accept. Streams go peer-to-peer.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={onDecline}
          className="flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-line bg-surface text-sm font-semibold text-zinc-200 transition hover:border-zinc-600 hover:text-white"
        >
          <XIcon /> Decline
        </button>
        <button
          onClick={onAccept}
          autoFocus
          className="flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-accent text-sm font-semibold text-ink transition hover:bg-accent-strong"
        >
          <CameraIcon size={15} /> Accept
        </button>
      </div>
    </div>
  );
}

export function OutgoingVideoCard({
  deadline,
  totalMs,
  preview,
  micOn,
  camOn,
  onToggleMic,
  onToggleCam,
  onCancel,
}: {
  deadline: number;
  totalMs: number;
  preview: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onCancel: () => void;
}) {
  const msLeft = useCountdown(deadline);
  const urgent = msLeft <= 10_000;
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject !== preview) {
      videoRef.current.srcObject = preview;
    }
  }, [preview]);

  return (
    <div
      aria-label="Video request sent"
      className="msg-in rounded-2xl border border-line bg-[#11141c] p-3.5"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-accent">
          <CameraIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Video request sent
          </p>
          <p className="flex items-center gap-2 text-sm font-semibold leading-tight">
            Waiting for Stranger
            <span className="flex items-center gap-0.5" aria-hidden>
              <span className="typing-dot !h-1 !w-1" />
              <span className="typing-dot !h-1 !w-1 [animation-delay:150ms]" />
              <span className="typing-dot !h-1 !w-1 [animation-delay:300ms]" />
            </span>
          </p>
        </div>
        <span
          className={`font-mono text-xs font-semibold tabular-nums ${
            urgent ? "text-red-400" : "text-zinc-300"
          }`}
        >
          {formatCountdown(msLeft)}
        </span>
        <button
          onClick={onCancel}
          className="h-9 cursor-pointer rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-zinc-200 transition hover:border-zinc-600 hover:text-white"
        >
          Cancel
        </button>
      </div>

      {/* Self-preview: local only, nothing is sent until they accept. */}
      <div className="relative mt-3 aspect-video overflow-hidden rounded-xl border border-line bg-[#0b0d13]">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full -scale-x-100 object-cover transition-opacity ${
            camOn && preview ? "opacity-100" : "opacity-0"
          }`}
        />
        {(!camOn || !preview) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-500">
            <PersonIcon size={26} />
            <p className="text-xs">
              {preview ? "Camera off" : "Starting camera…"}
            </p>
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-md bg-ink/80 px-2 py-0.5 text-[10px] font-medium text-zinc-300 backdrop-blur">
          You · preview
        </span>
        <p className="absolute inset-x-0 bottom-12 text-center text-[11px] text-zinc-300 [text-shadow:0_1px_4px_rgba(0,0,0,0.8)]">
          {camOn ? "Camera on — they'll see you once they accept" : ""}
        </p>
        <div className="absolute inset-x-0 bottom-2.5 flex justify-center gap-2">
          <ToggleButton
            on={micOn}
            onClick={onToggleMic}
            label={micOn ? "Mute microphone" : "Unmute microphone"}
          >
            {micOn ? <MicIcon /> : <MicOffIcon />}
          </ToggleButton>
          <ToggleButton
            on={camOn}
            onClick={onToggleCam}
            label={camOn ? "Turn camera off" : "Turn camera on"}
          >
            {camOn ? <CameraIcon /> : <CameraOffIcon />}
          </ToggleButton>
        </div>
      </div>

      <ProgressBar
        value={msLeft / totalMs}
        className={urgent ? "bg-red-400" : "bg-ember"}
      />
    </div>
  );
}

function ToggleButton({
  on,
  onClick,
  label,
  children,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={!on}
      title={label}
      className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border backdrop-blur transition ${
        on
          ? "border-line bg-ink/80 text-zinc-200 hover:text-white"
          : "border-red-500/40 bg-red-500/20 text-red-300"
      }`}
    >
      {children}
    </button>
  );
}

function ProgressBar({ value, className }: { value: number; className: string }) {
  return (
    <div className="mt-3 h-1 overflow-hidden rounded-full bg-line">
      <div
        className={`h-full rounded-full transition-[width] duration-300 ease-linear ${className}`}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}

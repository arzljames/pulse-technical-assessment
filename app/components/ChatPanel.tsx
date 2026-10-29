"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface ChatMessage {
  id: number;
  mine: boolean;
  text: string;
  at: number; // epoch ms, local clock
}

// How often we tell the peer "I'm typing" while keys are pressed.
const TYPING_PING_MS = 2_000;

// 12-hour clock, e.g. "7:02 AM".
function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function ChatPanel({
  messages,
  connected,
  videoBusy,
  peerPlace,
  peerTyping,
  onSend,
  onTyping,
  onStartVideo,
  onEnd,
  onSkip,
  videoSlot,
}: {
  messages: ChatMessage[];
  connected: boolean;
  videoBusy: boolean; // a video request/call is in progress
  peerPlace: string | null;
  peerTyping: boolean;
  onSend: (text: string) => void;
  onTyping: () => void;
  onStartVideo: () => void;
  onEnd: () => void;
  onSkip: () => void;
  // Video request card (incoming / outgoing), shown above the composer.
  videoSlot?: ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTypingPing = useRef(0);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, peerTyping]);

  // Ready to talk → put the cursor in the box.
  useEffect(() => {
    if (connected) inputRef.current?.focus();
  }, [connected]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !connected) return;
    onSend(text);
    setDraft("");
    lastTypingPing.current = 0;
  }

  function change(value: string) {
    setDraft(value);
    const now = Date.now();
    if (value && connected && now - lastTypingPing.current > TYPING_PING_MS) {
      lastTypingPing.current = now;
      onTyping();
    }
  }

  const canSend = connected && draft.trim().length > 0;

  return (
    <section
      aria-label="Chat with stranger"
      // Mobile sheet grows while a video card is showing, so messages stay visible.
      className={`chat-panel absolute inset-x-0 bottom-0 z-20 flex ${
        videoSlot ? "h-[85dvh]" : "h-[62dvh]"
      } flex-col rounded-t-3xl transition-[height] duration-300 border-t border-line bg-[#0a0c12]/95 text-foreground shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:h-auto sm:w-[400px] sm:rounded-none sm:border-l sm:border-t-0`}
    >
      {/* Grab handle (mobile sheet only, decorative). */}
      <div aria-hidden className="flex justify-center pt-2.5 sm:hidden">
        <span className="h-1 w-10 rounded-full bg-zinc-700" />
      </div>

      <header className="flex items-center gap-3 border-b border-line px-4 pb-3 pt-2 sm:py-4">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ember/30 bg-ember/10 text-ember">
          <PersonIcon />
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#0a0c12] ${
              connected ? "bg-live" : "live-blink bg-amber-400"
            }`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">Stranger</p>
          <p className="truncate text-xs text-zinc-500">
            {connected ? "Connected" : "Connecting…"}
            {connected && peerPlace && (
              <>
                {" · "}
                <span className="text-accent">{peerPlace}</span>
              </>
            )}
          </p>
        </div>
        <button
          onClick={onStartVideo}
          disabled={!connected || videoBusy}
          aria-label="Start video call"
          aria-pressed={videoBusy}
          title="Start video call"
          className={`flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border transition disabled:cursor-not-allowed ${
            videoBusy
              ? "border-accent bg-accent text-ink"
              : "border-line bg-surface text-zinc-300 hover:border-zinc-600 hover:text-white disabled:opacity-40"
          }`}
        >
          <CameraIcon />
        </button>
        <button
          onClick={onEnd}
          className="h-10 cursor-pointer rounded-xl bg-[#d63a3a] px-4 text-sm font-semibold text-white transition hover:bg-[#e04a4a]"
        >
          End
        </button>
      </header>

      <div
        role="log"
        aria-live="polite"
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        <div className="flex justify-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[11px] text-zinc-400">
            <LockIcon />
            Peer-to-peer · never stored
          </span>
        </div>

        {messages.length === 0 && (
          <p className="pt-6 text-center text-sm text-zinc-500">
            {connected ? "Say hello 👋" : "Opening a private channel…"}
          </p>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`msg-in flex flex-col ${m.mine ? "items-end" : "items-start"}`}
          >
            <p
              className={`max-w-[80%] whitespace-pre-wrap wrap-break-word rounded-2xl px-3.5 py-2 text-sm leading-snug ${
                m.mine
                  ? "bg-accent text-ink"
                  : "bg-[#1a1d27] text-zinc-100"
              }`}
            >
              {m.text}
            </p>
            <time className="mt-1 px-1 font-mono text-[10px] text-zinc-500">
              {formatTime(m.at)}
            </time>
          </div>
        ))}

        {peerTyping && (
          <div className="msg-in flex" aria-label="Stranger is typing">
            <span className="flex items-center gap-1 rounded-2xl bg-[#1a1d27] px-3.5 py-3">
              <span className="typing-dot" />
              <span className="typing-dot [animation-delay:150ms]" />
              <span className="typing-dot [animation-delay:300ms]" />
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {videoSlot && <div className="px-3 pb-3">{videoSlot}</div>}

      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <button
          type="button"
          onClick={onSkip}
          aria-label="Skip to someone new"
          title="Skip to someone new"
          className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface text-zinc-300 transition hover:border-zinc-600 hover:text-white"
        >
          <SkipIcon />
        </button>
        <div className="flex h-11 flex-1 items-center rounded-xl border border-line bg-surface pl-3.5 pr-1.5 focus-within:border-accent/60">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => change(e.target.value)}
            placeholder={connected ? "Type a message…" : "Connecting…"}
            disabled={!connected}
            maxLength={2000}
            aria-label="Message"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-accent text-ink transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            <SendIcon />
          </button>
        </div>
      </form>
    </section>
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

function PersonIcon() {
  return (
    <svg {...iconProps} width={18} height={18}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg {...iconProps} width={18} height={18}>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M16 10l6-3v10l-6-3z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg {...iconProps} width={11} height={11}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function SkipIcon() {
  return (
    <svg {...iconProps} width={16} height={16}>
      <path d="M6 5l9 7-9 7z" />
      <path d="M19 5v14" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg {...iconProps} width={16} height={16}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}

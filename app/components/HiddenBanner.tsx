"use client";

import { formatCountdown, useCountdown } from "@/lib/useCountdown";
import { ShieldIcon } from "./icons";

// Shown after the panic button: you're off the map until you choose to come
// back, and then only after a random delay, so the stranger you blocked
// can't match your old dot vanishing to a new one appearing nearby.
export default function HiddenBanner({
  rejoinAt,
  onGoVisible,
  onStayHidden,
}: {
  rejoinAt: number | null; // epoch ms, set once "Go back on the map" is tapped
  onGoVisible: () => void;
  onStayHidden: () => void;
}) {
  const left = useCountdown(rejoinAt);

  return (
    <div
      role="status"
      className="modal-in absolute inset-x-3 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 shadow-2xl backdrop-blur-xl"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
        <ShieldIcon />
      </div>
      <div className="min-w-0 flex-1">
        {rejoinAt === null ? (
          <>
            <p className="text-sm font-semibold">You&rsquo;re hidden from the map</p>
            <p className="text-xs text-zinc-400">No one can see or request you, and the map pauses.</p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold">
              Back on the map in{" "}
              <span className="font-mono tabular-nums">{formatCountdown(left)}</span>
            </p>
            <p className="text-xs text-zinc-400">
              A random wait, so your new dot can&rsquo;t be linked to you.
            </p>
          </>
        )}
      </div>
      {rejoinAt === null ? (
        <button
          onClick={onGoVisible}
          className="h-10 shrink-0 cursor-pointer rounded-xl bg-accent px-3.5 text-sm font-semibold text-ink transition hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          Go back
        </button>
      ) : (
        <button
          onClick={onStayHidden}
          className="h-10 shrink-0 cursor-pointer rounded-xl border border-line bg-[#1a1d27] px-3.5 text-sm font-semibold text-zinc-100 transition hover:bg-[#232735] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
        >
          Stay hidden
        </button>
      )}
    </div>
  );
}

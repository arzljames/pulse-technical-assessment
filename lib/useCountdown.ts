"use client";

import { useEffect, useState } from "react";

// Milliseconds left until `deadline` (epoch ms), re-rendering a few times a
// second. Purely visual — the real timeouts live in setTimeout calls, so a
// throttled tab can't make anything late.
export function useCountdown(deadline: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);

  return deadline === null ? 0 : Math.max(0, deadline - now);
}

// 25_400 → "0:26"
export function formatCountdown(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

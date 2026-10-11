"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** A play/pause clock in seconds, driven by requestAnimationFrame. */
export function usePlayback(total: number, opts: { autoplay?: boolean; startAt?: number } = {}) {
  const [t, setT] = useState(() => Math.max(0, Math.min(total, opts.startAt ?? 0)));
  const [playing, setPlaying] = useState(!!opts.autoplay);
  const [rate, setRate] = useState(1);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      last.current = null;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      const dt = last.current == null ? 0 : (now - last.current) / 1000;
      last.current = now;
      setT((prev) => {
        const next = prev + dt * rate;
        if (next >= total) {
          setPlaying(false);
          return total;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate, total]);

  const seek = useCallback((to: number) => setT(Math.max(0, Math.min(total, to))), [total]);
  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (!p) setT((cur) => (cur >= total ? 0 : cur));
      return !p;
    });
  }, [total]);

  return { t, playing, rate, setRate, seek, toggle, setPlaying };
}

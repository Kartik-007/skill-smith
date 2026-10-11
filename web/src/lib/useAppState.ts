"use client";
import { useEffect, useRef, useState } from "react";
import type { AppState } from "./types";

export type Mode = "live" | "replay" | "mock";

/**
 * Poll /api/state every second. In replay mode read /replay.json once: a single state is shown as-is,
 * an array of states is played back one frame per second, looping.
 */
export function useAppState(mode: Mode, initial: AppState | null) {
  const [state, setState] = useState<AppState | null>(initial);
  const [stale, setStale] = useState(false);
  const lastOk = useRef(Date.now());

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;

    if (mode === "replay") {
      fetch("/replay.json", { cache: "no-store" })
        .then((r) => r.json())
        .then((data: AppState | AppState[]) => {
          if (!alive) return;
          const frames = (Array.isArray(data) ? data : [data]).map((f) => ({ ...f, source: "replay" as const }));
          if (!frames.length) return;
          let i = 0;
          setState(frames[0]);
          if (frames.length > 1) {
            timer = setInterval(() => {
              i = (i + 1) % frames.length;
              setState(frames[i]);
            }, 1000);
          }
        })
        .catch(() => setStale(true));
      return () => {
        alive = false;
        if (timer) clearInterval(timer);
      };
    }

    let inflight = false;
    const url = mode === "mock" ? "/api/state?mock=1" : "/api/state";
    const tick = async () => {
      if (inflight) return;
      inflight = true;
      const ctl = new AbortController();
      const kill = setTimeout(() => ctl.abort(), 4000);
      try {
        const r = await fetch(url, { cache: "no-store", signal: ctl.signal });
        if (!r.ok) throw new Error(String(r.status));
        const next = (await r.json()) as AppState;
        if (!alive) return;
        lastOk.current = Date.now();
        setState(next);
        setStale(false);
      } catch {
        if (alive && Date.now() - lastOk.current > 3500) setStale(true);
      } finally {
        clearTimeout(kill);
        inflight = false;
      }
    };
    tick();
    timer = setInterval(tick, 1000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [mode]);

  return { state, stale };
}

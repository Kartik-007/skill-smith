"use client";
import { activeStage, baselineVersion, incumbent } from "@/lib/derive";
import type { AppState } from "@/lib/types";
import { useAppState, type Mode } from "@/lib/useAppState";
import { Feed } from "./Feed";
import { Header } from "./Header";
import { HillClimb } from "./HillClimb";
import { LiveOrderForm } from "./LiveOrderForm";
import { NightShift } from "./NightShift";
import { Theater } from "./Theater";

const FRESH_MS = 15_000;

export function Stage({ mode, initial }: { mode: Mode; initial: AppState | null }) {
  const { state, stale } = useAppState(mode, initial);

  if (!state) {
    return (
      <main className="flex h-dvh items-center justify-center text-mute">
        <span className="animate-pulse text-lg tracking-[0.2em] uppercase">Skill Smith</span>
      </main>
    );
  }

  const now = Date.parse(state.now);
  const mocked = new Set(state.mocked);
  const base = baselineVersion(state.versions);
  const best = incumbent(state.versions);
  const deltaH =
    base?.scores?.H != null && best?.scores?.H != null && best.version !== base.version
      ? best.scores.H - base.scores.H
      : null;
  const lastVerdict = state.feed.find((f) => f.type === "verdict");
  const verdictFresh = lastVerdict ? now - Date.parse(lastVerdict.ts) < FRESH_MS : false;
  const story = state.showcase.best ?? state.showcase.baseline;
  const coder = best?.models?.coder ?? base?.models?.coder ?? null;

  const formDisabled =
    state.source === "replay"
      ? "replay mode: orders are not sent"
      : state.source === "mock" && state.db_error
        ? "Atlas is not connected"
        : null;

  return (
    <main className="flex h-dvh w-full flex-col gap-3 p-4 max-[1100px]:h-auto max-[1100px]:min-h-dvh">
      <Header
        state={state}
        stale={stale}
        active={activeStage(state)}
        customer={story?.customer ?? "Dev Ittycheria"}
        nSnacks={story?.n_items || 3}
        coder={coder}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)] grid-rows-[minmax(0,1.42fr)_minmax(0,1fr)] gap-3 [@media(max-height:760px)]:grid-rows-[minmax(0,1.28fr)_minmax(0,1fr)] max-[1100px]:grid-cols-1 max-[1100px]:grid-rows-[60vh_420px_420px_420px]">
        <Theater showcase={state.showcase} deltaH={deltaH} />
        <HillClimb versions={state.versions} sample={mocked.has("versions")} fresh={verdictFresh} />
        <NightShift
          queue={state.queue}
          recovery={state.recoveries[0] ?? null}
          nowIso={state.now}
          sampleQueue={mocked.has("queue")}
          sampleRecovery={mocked.has("recoveries")}
        >
          <LiveOrderForm products={state.products} requests={state.live_requests} disabled={formDisabled} />
        </NightShift>
        <Feed feed={state.feed} nowIso={state.now} sample={mocked.has("feed")} />
      </div>
    </main>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { FAMILY_COLOR, FAMILY_WORD, shortName, type TheaterView } from "@/lib/derive";
import type { RunItem, RunSummary, Showcase } from "@/lib/types";

type View = TheaterView;

function LoopVideo({ src, poster }: { src: string; poster?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true; // React does not reliably set the muted attribute; autoplay needs it
    const kick = () => {
      if (v.paused && document.visibilityState === "visible") v.play().catch(() => {});
    };
    kick();
    // browsers pause muted autoplay when the tab or window is hidden; resume when it comes back
    const timer = setInterval(kick, 2000);
    document.addEventListener("visibilitychange", kick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", kick);
    };
  }, [src]);
  if (failed) return <Blank text="video not found on this machine" />;
  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      autoPlay
      playsInline
      preload="auto"
      onError={() => setFailed(true)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

function Blank({ text, pulse = false }: { text: string; pulse?: boolean }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_50%_40%,#0b3446,#00151f_70%)]">
      <span className={`text-[1.05rem] text-mute ${pulse ? "animate-pulse" : ""}`}>{text}</span>
    </div>
  );
}

function Chip({ item }: { item: RunItem }) {
  const key = item.ok ? "ok" : (item.family ?? "in_box");
  const color = FAMILY_COLOR[key];
  return (
    <span
      title={item.detail || undefined}
      className="inline-flex items-center gap-2 rounded-full bg-black/65 px-3 py-1 text-[0.95rem] font-medium backdrop-blur-sm"
      style={{ boxShadow: `inset 0 0 0 1.5px ${color}` }}
    >
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span className="text-text">{shortName(item.product_id, item.label)}</span>
      <span className="text-[0.8rem] font-bold uppercase tracking-wider" style={{ color }}>
        {FAMILY_WORD[key]}
      </span>
    </span>
  );
}

function Screen({
  run,
  eyebrow,
  title,
  tone,
  empty,
}: {
  run: RunSummary | null;
  eyebrow: string;
  title: string;
  tone: "bad" | "good" | "live";
  empty: string;
}) {
  const ring = tone === "good" ? "ring-leaf/70" : tone === "bad" ? "ring-crush/45" : "ring-budget/70";
  const scoreColor =
    run && run.n_items ? (run.damage_free === run.n_items ? "text-leaf" : run.damage_free === 0 ? "text-crush" : "text-tip") : "text-mute";
  const running = run && !run.video && run.status !== "done";
  return (
    <div className={`relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl bg-black ring-2 ${ring}`}>
      {run?.video ? (
        <LoopVideo key={run.video} src={run.video} />
      ) : run?.frame ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={run.frame} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <Blank text={running ? (run.status === "planning" ? "coder is writing the program…" : "packing…") : empty} pulse={Boolean(running)} />
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/75 via-black/30 to-transparent px-4 pb-10 pt-3">
        <div>
          <div className="text-[0.75rem] font-semibold uppercase tracking-[0.22em] text-text/70">{eyebrow}</div>
          <div className={`text-[1.7rem] font-bold leading-tight ${tone === "good" ? "text-leaf" : "text-text"}`}>{title}</div>
        </div>
        {run && run.n_items ? (
          <div className="text-right">
            <div className={`font-mono text-[2rem] font-bold leading-none tabular ${scoreColor}`}>
              {run.status === "done" || run.video ? `${run.damage_free}/${run.n_items}` : `–/${run.n_items}`}
            </div>
            <div className="mt-1 text-[0.8rem] uppercase tracking-wider text-text/70">damage-free</div>
          </div>
        ) : null}
      </div>

      {run && run.items.length && (run.status === "done" || run.video) ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap gap-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-3 pt-10">
          {run.items.map((it) => (
            <Chip key={it.id} item={it} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const TABS: { id: View; label: string; key: string }[] = [
  { id: "both", label: "v0 vs best", key: "1" },
  { id: "v0", label: "v0", key: "2" },
  { id: "best", label: "best", key: "3" },
  { id: "live", label: "live order", key: "4" },
];

export function Theater({
  showcase,
  deltaH,
  sample,
  initialView = "both",
}: {
  showcase: Showcase;
  deltaH: number | null;
  sample: boolean;
  initialView?: View;
}) {
  const [view, setView] = useState<View>(initialView);
  const liveId = showcase.live?.id ?? null;
  const seenLive = useRef<string | null | undefined>(undefined);

  // a judge's order appears: cut to it
  useEffect(() => {
    if (seenLive.current !== undefined && liveId && liveId !== seenLive.current) setView("live");
    seenLive.current = liveId;
  }, [liveId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      const tab = TABS.find((x) => x.key === e.key || (x.id === "live" && e.key.toLowerCase() === "l"));
      if (tab) setView(tab.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { baseline, best, live } = showcase;
  const effective: View = view === "live" && !live ? "both" : view;
  const bestTitle = best?.version != null ? `v${best.version}` : "best";
  const liveScreen = (
    <Screen
      run={live}
      eyebrow={live?.version != null ? `live order · harness v${live.version}` : "live order"}
      title={live?.customer ? `for ${live.customer}` : "live order"}
      tone="live"
      empty="waiting for a judge's order"
    />
  );

  return (
    <section className="relative flex min-h-0 min-w-0 flex-col rounded-2xl border border-line/80 bg-ink-2/80 p-3">
      <header className="mb-2.5 flex shrink-0 items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="shrink-0 text-[0.8rem] font-semibold uppercase tracking-[0.22em] text-leaf">Robot theater</h2>
          <span className="truncate text-[0.95rem] text-mute">
            Franka Panda in MuJoCo · same order, same model
            {deltaH != null && deltaH !== 0 ? (
              <>
                {" · "}
                <span className="font-semibold text-leaf">
                  {deltaH > 0 ? "+" : "−"}
                  {Math.abs(deltaH).toFixed(0)} pts
                </span>{" "}
                held-out
              </>
            ) : null}
          </span>
          {sample ? (
            <span
              title="No showcase runs with video yet; showing a placeholder clip"
              className="shrink-0 rounded border border-line-2 px-1.5 py-px text-[0.65rem] uppercase tracking-widest text-faint"
            >
              sample
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1 rounded-lg border border-line/70 bg-panel/50 p-0.5">
          {TABS.filter((t) => t.id !== "live" || live).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              title={`key ${t.key}`}
              className={`rounded-md px-2.5 py-1 text-[0.8rem] font-medium transition-colors ${
                effective === t.id
                  ? "bg-leaf text-ink"
                  : t.id === "live"
                    ? "text-budget hover:text-text"
                    : "text-mute hover:text-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-3">
        {effective === "both" ? (
          <>
            <Screen run={baseline} eyebrow="before · harness" title="v0" tone="bad" empty="no v0 video yet" />
            <Screen run={best} eyebrow="after · best harness" title={bestTitle} tone="good" empty="no best video yet" />
          </>
        ) : effective === "v0" ? (
          <Screen run={baseline} eyebrow="before · harness" title="v0" tone="bad" empty="no v0 video yet" />
        ) : effective === "best" ? (
          <Screen run={best} eyebrow="after · best harness" title={bestTitle} tone="good" empty="no best video yet" />
        ) : (
          liveScreen
        )}
      </div>
    </section>
  );
}

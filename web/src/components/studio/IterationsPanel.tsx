"use client";

import type { Cursor, Timeline } from "@/lib/story/timeline";
import type { Story } from "@/lib/story/types";
import { cx } from "./format";
import { Icon } from "./icons";

export function IterationsPanel({
  story,
  tl,
  cursor,
  t,
  onSeek,
}: {
  story: Story;
  tl: Timeline;
  cursor: Cursor;
  t: number;
  onSeek: (t: number) => void;
}) {
  return (
    <aside className="card flex min-h-0 flex-col overflow-hidden">
      <div className="border-b border-line px-5 pt-4 pb-3">
        <h2 className="text-[1.05rem] font-semibold">Iterations</h2>
        <p className="mt-1 text-[0.8rem] leading-snug text-mute">Kept versions. Same order every time.</p>
      </div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {tl.segments.map((seg, si) => {
          const active = cursor.si === si;
          const progress = active ? (t - seg.start) / seg.dur : t > seg.start ? 1 : 0;
          if (seg.kind === "run") {
            const v = story.versions[seg.vi];
            const results = v.run.steps.map((s) => s.result.ok);
            // a step's result only shows once the playhead has passed it
            const revealed = seg.phases.filter((p) => p.kind === "place" && t >= p.start + p.dur).length;
            return (
              <button
                key={si}
                type="button"
                onClick={() => onSeek(seg.start)}
                className={cx(
                  "relative block w-full overflow-hidden rounded-xl border px-4 py-3 text-left transition-all",
                  active
                    ? "border-accent bg-accent-soft/60 shadow-[0_0_0_3px_rgb(43_89_224/0.12)]"
                    : "border-line bg-surface hover:border-line-2",
                )}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[1.35rem] font-semibold">v{v.version}</span>
                  <span
                    className={cx(
                      "rounded px-1.5 py-0.5 text-[0.65rem] font-medium tracking-wide uppercase",
                      v.version === 0 ? "bg-sunk text-mute" : "bg-ok-soft text-ok",
                    )}
                  >
                    {v.version === 0 ? "baseline" : "kept"}
                  </span>
                  <span className="ml-auto font-mono text-[0.95rem] font-semibold tabular">
                    {v.scores.T.toFixed(0)}%
                  </span>
                </div>
                <div className="mt-1 truncate font-mono text-[0.72rem] text-mute">{v.patch_text}</div>
                <div className="mt-2.5 flex items-center gap-1.5">
                  {results.map((ok, i) => (
                    <span
                      key={i}
                      className={cx(
                        "h-2.5 flex-1 rounded-full transition-colors duration-300",
                        i >= revealed ? "bg-line" : ok ? "bg-ok" : "bg-bad",
                      )}
                    />
                  ))}
                  <span className="ml-1 text-[0.7rem] text-mute tabular">
                    {revealed >= results.length
                      ? `${results.filter(Boolean).length}/${results.length}`
                      : "story"}
                  </span>
                </div>
                <div className="mt-1 text-[0.68rem] text-faint">train score · story order</div>
                <span
                  className="absolute bottom-0 left-0 h-0.5 bg-accent transition-[width] duration-200"
                  style={{ width: `${progress * 100}%` }}
                />
              </button>
            );
          }
          const tr = story.transitions[seg.ti];
          return (
            <button
              key={si}
              type="button"
              onClick={() => onSeek(seg.start)}
              className={cx(
                "group relative my-1 ml-5 flex w-[calc(100%-1.25rem)] items-center gap-2 border-l-2 py-3 pl-4 text-left",
                active ? "border-accent" : "border-line",
              )}
            >
              <span
                className={cx(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-full",
                  active ? "bg-accent text-white" : "bg-sunk text-mute group-hover:text-ink",
                )}
              >
                <Icon name="brain" size={15} />
              </span>
              <span className="min-w-0">
                <span className={cx("block text-[0.78rem] font-medium", active ? "text-accent" : "text-ink-2")}>
                  Meta-agent
                </span>
                <span className="block truncate font-mono text-[0.68rem] text-mute">
                  {tr.patch.path.split(".").pop()} {tr.patch.before} → {tr.patch.after}
                </span>
              </span>
              {active && (
                <span className="ml-auto h-2 w-2 shrink-0 animate-pulse-dot rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

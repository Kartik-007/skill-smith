"use client";

import { useRef } from "react";
import { fmtTime, type Timeline as TL } from "@/lib/story/timeline";
import type { Story } from "@/lib/story/types";
import { cx } from "./format";
import { Icon } from "./icons";

export function Timeline({
  story,
  tl,
  t,
  playing,
  rate,
  onToggle,
  onSeek,
  onRate,
}: {
  story: Story;
  tl: TL;
  t: number;
  playing: boolean;
  rate: number;
  onToggle: () => void;
  onSeek: (t: number) => void;
  onRate: (r: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);

  const seekFromEvent = (clientX: number) => {
    const el = track.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    onSeek(((clientX - box.left) / box.width) * tl.total);
  };

  const starts = tl.segments.map((s) => s.start);
  const prev = () => {
    const before = starts.filter((s) => s < t - 1);
    onSeek(before.length ? before[before.length - 1] : 0);
  };
  const next = () => {
    const after = starts.find((s) => s > t + 0.01);
    if (after != null) onSeek(after);
  };

  return (
    <div className="card flex items-center gap-4 px-4 py-3">
      <div className="flex items-center gap-1">
        <IconBtn label="Previous section" onClick={prev}>
          <Icon name="prev" size={16} />
        </IconBtn>
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={onToggle}
          className="grid h-10 w-10 place-items-center rounded-full bg-ink text-white transition-transform hover:scale-105 active:scale-95"
        >
          <Icon name={playing ? "pause" : "play"} size={18} />
        </button>
        <IconBtn label="Next section" onClick={next}>
          <Icon name="next" size={16} />
        </IconBtn>
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex">
          {tl.segments.map((s, i) => (
            <div key={i} style={{ flexGrow: s.dur, flexBasis: 0 }} className="min-w-0 truncate px-0.5 text-[0.7rem]">
              {s.kind === "run" ? (
                <span className="font-mono font-semibold text-ink-2">v{story.versions[s.vi].version}</span>
              ) : (
                <span className="text-accent">meta-agent</span>
              )}
            </div>
          ))}
        </div>
        <div
          ref={track}
          role="slider"
          aria-label="Story position"
          aria-valuemin={0}
          aria-valuemax={Math.round(tl.total)}
          aria-valuenow={Math.round(t)}
          tabIndex={0}
          className="relative flex h-5 cursor-pointer items-center"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            seekFromEvent(e.clientX);
          }}
          onPointerMove={(e) => e.buttons === 1 && seekFromEvent(e.clientX)}
        >
          <div className="flex h-2.5 w-full gap-[3px]">
            {tl.segments.map((s, i) =>
              s.kind === "run" ? (
                <div key={i} style={{ flexGrow: s.dur, flexBasis: 0 }} className="flex gap-px overflow-hidden rounded-sm">
                  {s.phases.map((ph, k) => {
                    const step = ph.kind === "place" ? story.versions[s.vi].run.steps[ph.step] : null;
                    return (
                      <div
                        key={k}
                        style={{ flexGrow: ph.dur, flexBasis: 0 }}
                        className={cx(
                          step ? (step.result.ok ? "bg-ok/70" : "bg-bad/70") : "bg-line-2",
                          t < ph.start && "opacity-40",
                        )}
                      />
                    );
                  })}
                </div>
              ) : (
                <div
                  key={i}
                  style={{ flexGrow: s.dur, flexBasis: 0 }}
                  className={cx("rounded-sm bg-accent/70", t < s.start && "opacity-30")}
                />
              ),
            )}
          </div>
          <div
            className="pointer-events-none absolute top-1/2 h-5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink shadow"
            style={{ left: `${(t / tl.total) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="font-mono text-[0.8rem] text-mute tabular">
          {fmtTime(t)} / {fmtTime(tl.total)}
        </span>
        <div className="flex overflow-hidden rounded-md border border-line text-[0.75rem]">
          {[1, 2].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRate(r)}
              className={cx("px-2 py-1 font-mono", rate === r ? "bg-ink text-white" : "text-mute hover:bg-sunk")}
            >
              {r}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-full text-ink-2 hover:bg-sunk"
    >
      {children}
    </button>
  );
}

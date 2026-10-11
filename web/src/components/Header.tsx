"use client";
import { Fragment } from "react";
import { STAGES, modelName, type Stage } from "@/lib/derive";
import type { AppState } from "@/lib/types";
import { Icon } from "./Icons";

function SourceBadge({ state, stale }: { state: AppState; stale: boolean }) {
  let dot = "bg-leaf";
  let text = "Atlas live";
  if (stale) {
    dot = "bg-tip";
    text = "reconnecting";
  } else if (state.source === "replay") {
    dot = "bg-budget";
    text = "replay";
  } else if (state.source === "mock") {
    dot = "bg-tip";
    text = state.db_error ? "sample data (no Atlas)" : "sample data";
  }
  return (
    <div className="flex shrink-0 items-center gap-2 text-[0.8rem] uppercase tracking-[0.18em] text-mute">
      <span className="relative flex h-2.5 w-2.5">
        {state.source === "db" && !stale ? (
          <span className={`absolute inset-0 animate-ping-soft rounded-full ${dot}`} />
        ) : null}
        <span className={`relative h-2.5 w-2.5 rounded-full ${dot}`} />
      </span>
      {text}
    </div>
  );
}

export function PipelineStrip({ active }: { active: Stage | null }) {
  return (
    <ol className="flex min-w-0 flex-1 items-stretch gap-1.5">
      {STAGES.map((s, i) => {
        const on = s.id === active;
        return (
          <Fragment key={s.id}>
            {i > 0 ? (
              <li aria-hidden className={`flex items-center ${on ? "text-leaf" : "text-line-2"}`}>
                <Icon name="chevron" size={16} />
              </li>
            ) : null}
            <li
              className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border px-3 py-1.5 transition-colors duration-500 ${
                on ? "animate-glow border-leaf bg-leaf/10" : "border-line/70 bg-panel/40"
              }`}
            >
              <span className="relative flex h-2 w-2 shrink-0">
                {on ? <span className="absolute inset-0 animate-ping-soft rounded-full bg-leaf" /> : null}
                <span className={`relative h-2 w-2 rounded-full ${on ? "bg-leaf" : "bg-line-2"}`} />
              </span>
              <span className="min-w-0">
                <span className={`block text-[1rem] font-semibold leading-tight ${on ? "text-leaf" : "text-text/85"}`}>
                  {s.name}
                </span>
                <span className={`block truncate text-[0.75rem] leading-tight ${on ? "text-text/80" : "text-faint"}`}>
                  {s.hint}
                </span>
              </span>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

export function Header({
  state,
  stale,
  active,
  customer,
  nSnacks,
  coder,
}: {
  state: AppState;
  stale: boolean;
  active: Stage | null;
  customer: string;
  nSnacks: number;
  coder: string | null;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-3">
      <div className="flex items-end justify-between gap-6">
        <div className="flex min-w-0 items-baseline gap-4">
          <h1 className="flex shrink-0 items-center gap-2 text-[1.6rem] font-bold tracking-[0.16em] text-leaf">
            <Icon name="leaf" size={24} className="translate-y-[1px]" />
            SKILL SMITH
          </h1>
          <p className="truncate text-[1.35rem] font-medium text-text">
            Snack box for {customer}
            <span className="text-mute"> · {nSnacks} new snacks</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[1.2rem] font-semibold leading-tight">
            The model never changes. <span className="text-leaf">The harness does.</span>
          </p>
          {coder ? (
            <p className="mt-0.5 text-[0.85rem] text-mute">
              coder <span className="font-mono text-text/90">{modelName(coder)}</span> · same model since v0
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <PipelineStrip active={active} />
        <SourceBadge state={state} stale={stale} />
      </div>
    </div>
  );
}

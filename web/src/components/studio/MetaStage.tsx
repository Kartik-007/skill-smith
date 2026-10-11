"use client";

import { META, META_STATES } from "@/lib/story/timeline";
import type { Transition } from "@/lib/story/types";
import { cx } from "./format";
import { Icon, type IconName } from "./icons";

const ICONS: IconName[] = ["drop", "bulb", "patch", "gavel", "flag"];
const SUBS = ["", "what's going wrong", "one knob, typed", "paired eval, guardrails", "keep or roll back"];

type Status = "pending" | "active" | "done";

export function MetaStage({ tr, state, p }: { tr: Transition; state: number; p: number }) {
  const status = (i: number): Status => (i < state ? "done" : i === state ? "active" : "pending");
  // how far into a state's content we are; finished states show everything
  const reveal = (i: number) => (i < state ? 1 : i === state ? p : 0);

  const sub = (i: number) =>
    i === META.signals ? (tr.signals.source === "raindrop" ? "Raindrop + Atlas" : "Atlas") : SUBS[i];
  const card = (i: number) => (
    <StateCard key={i} i={i} status={status(i)} sub={sub(i)}>
      {status(i) !== "pending" && <StateBody i={i} tr={tr} r={reveal(i)} />}
    </StateCard>
  );

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-line bg-surface px-8 py-6"
      style={{
        backgroundImage: "radial-gradient(circle, rgb(23 23 26 / 0.07) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-white">
          <Icon name="brain" size={20} />
        </span>
        <div>
          <div className="text-[1.15rem] font-semibold">
            Meta-agent evolves the harness: v{tr.from} <span className="text-mute">→</span> v{tr.to}
          </div>
          <div className="text-[0.8rem] text-mute">
            {tr.model} reads what went wrong, then proposes exactly one change. A gate decides if it stays.
          </div>
        </div>
        {tr.sample && (
          <span className="ml-auto rounded-md border border-dashed border-line-2 px-2 py-1 text-[0.7rem] text-mute">
            sample data
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-stretch">
          {card(META.signals)}
          <Arrow on={state > META.signals} />
          {card(META.hypothesis)}
        </div>
        <div className="h-10 shrink-0">
          <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-full w-full overflow-visible">
            <path
              d="M 75 0 C 75 6, 16 4, 16 10"
              fill="none"
              stroke={state > META.hypothesis ? "var(--color-accent)" : "var(--color-line-2)"}
              strokeWidth={2}
              strokeDasharray={state > META.hypothesis ? "0" : "5 5"}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
        <div className="flex min-h-0 flex-1 items-stretch">
          {card(META.patch)}
          <Arrow on={state > META.patch} />
          {card(META.gate)}
          <Arrow on={state > META.gate} />
          {card(META.verdict)}
        </div>
      </div>
    </div>
  );
}

function Arrow({ on }: { on: boolean }) {
  return (
    <div className="flex items-center px-2">
      <div className={cx("h-0.5 w-6 transition-colors", on ? "bg-accent" : "bg-line-2")} />
      <div
        className={cx(
          "h-0 w-0 border-y-[5px] border-l-[7px] border-y-transparent transition-colors",
          on ? "border-l-accent" : "border-l-line-2",
        )}
      />
    </div>
  );
}

function StateCard({ i, status, sub, children }: { i: number; status: Status; sub: string; children: React.ReactNode }) {
  return (
    <div
      className={cx(
        "flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border bg-surface p-4 transition-all duration-300",
        status === "active" && "border-accent shadow-[0_0_0_4px_rgb(43_89_224/0.12),0_8px_24px_rgb(23_23_26/0.08)]",
        status === "done" && "border-line shadow-sm",
        status === "pending" && "border-dashed border-line-2 bg-surface/60",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cx(
            "grid h-7 w-7 place-items-center rounded-lg",
            status === "active" ? "bg-accent text-white" : status === "done" ? "bg-accent-soft text-accent" : "bg-sunk text-faint",
          )}
        >
          <Icon name={status === "done" ? "check" : ICONS[i]} size={15} />
        </span>
        <span className={cx("text-[0.92rem] font-semibold", status === "pending" && "text-faint")}>
          {META_STATES[i]}
        </span>
        <span className={cx("ml-auto text-[0.68rem]", status === "pending" ? "text-faint" : "text-mute")}>{sub}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function SourceChip({ source }: { source: "raindrop" | "atlas" }) {
  return (
    <span
      className={cx(
        "shrink-0 rounded px-1.5 py-0.5 text-[0.62rem] font-medium uppercase",
        source === "raindrop" ? "bg-[#f1ebfd] text-[#6b3fd1]" : "bg-ok-soft text-ok",
      )}
    >
      {source}
    </span>
  );
}

function typed(text: string, r: number) {
  return text.slice(0, Math.round(text.length * Math.min(1, r * 1.4)));
}

function StateBody({ i, tr, r }: { i: number; tr: Transition; r: number }) {
  switch (i) {
    case META.signals: {
      const max = Math.max(...tr.signals.failures.map((f) => f.count));
      return (
        <div className="animate-enter space-y-1.5">
          {tr.signals.failures.map((f, k) => (
            <div key={f.family} className="flex items-center gap-2 text-[0.78rem]">
              <span className="w-20 shrink-0 text-ink-2">{f.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-sunk">
                <div
                  className="h-full rounded-full bg-bad/80 transition-[width] duration-700"
                  style={{ width: `${(r > k * 0.15 ? f.count / max : 0) * 100}%` }}
                />
              </div>
              <span className="w-8 text-right font-mono text-[0.72rem] text-mute tabular">{f.count.toFixed(1)}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1.5 text-[0.72rem] text-mute">
            <SourceChip source="atlas" />
            memory: {tr.signals.memory.skills} skills, {tr.signals.memory.lessons} lessons stored
          </div>
        </div>
      );
    }
    case META.hypothesis:
      return (
        <p className="font-[family-name:var(--font-sans)] text-[0.9rem] leading-relaxed text-ink">
          “{typed(tr.hypothesis, r)}
          {r < 0.7 ? <span className="animate-caret text-accent">▍</span> : "”"}
        </p>
      );
    case META.patch:
      return (
        <div className="animate-enter">
          <div className="font-mono text-[0.75rem] text-mute">{tr.patch.op}</div>
          <div className="mt-1.5 flex items-baseline gap-2 rounded-lg bg-change-soft px-3 py-2 font-mono">
            <span className="text-[0.85rem] text-change">{tr.patch.path}</span>
            <span className="ml-auto text-[1rem] text-mute line-through">{tr.patch.before}</span>
            <span className="text-change">→</span>
            <span className="text-[1.15rem] font-semibold text-change">{tr.patch.after}</span>
          </div>
          {r > 0.3 && (
            <p className="animate-enter mt-2 text-[0.75rem] leading-snug text-ink-2">
              <span className="font-medium">Expects: </span>
              {tr.patch.predicted_effect}
            </p>
          )}
        </div>
      );
    case META.gate: {
      const g = tr.gate;
      const shown = Math.min(g.guardrails.length, Math.floor(Math.max(0, r - 0.3) * 1.6 * g.guardrails.length));
      return (
        <div className="animate-enter">
          <ScoreRow label="Train" a={g.T[0]} b={g.T[1]} r={r} />
          <ScoreRow label="Held-out" a={g.H[0]} b={g.H[1]} r={r} />
          <div className="mt-1 text-[0.72rem] text-mute">
            P(better) <span className="font-mono text-ink">{g.p_better.toFixed(2)}</span> · needs ≥ 0.80
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {g.guardrails.slice(0, shown).map((gr) => (
              <li key={gr.name} className="animate-enter flex items-center gap-1.5 text-[0.7rem]">
                <Icon name={gr.ok ? "check" : "x"} size={12} className={gr.ok ? "text-ok" : "text-bad"} />
                <span className="text-ink-2">{gr.name}</span>
                <span className="ml-auto font-mono text-mute">{gr.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case META.verdict: {
      const kept = tr.verdict.status === "kept";
      return (
        <div className="animate-enter flex h-full flex-col justify-center">
          <div
            className={cx(
              "inline-flex w-fit items-center gap-2 rounded-lg px-3 py-1.5 text-[1.05rem] font-semibold",
              kept ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad",
            )}
          >
            <Icon name={kept ? "check" : "x"} size={18} />
            {kept ? `Kept · harness is now v${tr.to}` : tr.verdict.status.replace("_", " ")}
          </div>
          <p className="mt-2 text-[0.78rem] text-ink-2">{tr.verdict.reason}</p>
          <p className="mt-1 font-mono text-[0.68rem] text-mute">meta-agent cost ${tr.cost_usd.toFixed(4)}</p>
        </div>
      );
    }
  }
  return null;
}

function ScoreRow({ label, a, b, r }: { label: string; a: number; b: number; r: number }) {
  const grow = Math.min(1, r * 2);
  const now = a + (b - a) * grow;
  return (
    <div className="flex items-center gap-2 py-0.5 text-[0.78rem]">
      <span className="w-16 shrink-0 text-ink-2">{label}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-sunk">
        <div className="absolute inset-y-0 left-0 rounded-full bg-line-2" style={{ width: `${a}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-ok" style={{ width: `${now}%`, opacity: 0.85 }} />
      </div>
      <span className="w-24 text-right font-mono text-[0.72rem] tabular">
        <span className="text-mute">{a.toFixed(0)}</span> → <span className="font-semibold text-ok">{now.toFixed(0)}%</span>
      </span>
    </div>
  );
}

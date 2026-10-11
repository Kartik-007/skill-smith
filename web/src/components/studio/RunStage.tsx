"use client";

import { useEffect, useRef } from "react";
import type { Phase } from "@/lib/story/timeline";
import type { Story, Version } from "@/lib/story/types";
import { cx, FAMILY_LABEL, fmtGrip, fmtSpeed } from "./format";
import { Icon } from "./icons";

/** fraction of a place clip after which its referee result is shown */
const RESULT_AT = 0.82;

export function RunStage({
  story,
  version,
  phase,
  local,
  p,
  playing,
  rate,
}: {
  story: Story;
  version: Version;
  phase: Phase;
  local: number;
  p: number;
  playing: boolean;
  rate: number;
}) {
  const steps = version.run.steps;
  const activeClip = phase.kind === "plan" ? 0 : phase.kind === "verify" ? steps.length - 1 : phase.step;
  const refs = useRef<(HTMLVideoElement | null)[]>([]);

  // keep the active clip on the story clock; others stay paused
  useEffect(() => {
    refs.current.forEach((v, i) => {
      if (!v) return;
      if (i !== activeClip) {
        if (!v.paused) v.pause();
        return;
      }
      const dur = Number.isFinite(v.duration) ? v.duration : steps[i].clip.duration_s;
      const target = phase.kind === "plan" ? 0 : phase.kind === "verify" ? Math.max(0, dur - 0.05) : local;
      const shouldPlay = playing && phase.kind === "place";
      v.playbackRate = rate;
      if (shouldPlay) {
        if (v.paused) v.play().catch(() => {});
        if (Math.abs(v.currentTime - target) > 0.35) v.currentTime = target;
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > 0.04) v.currentTime = target;
      }
    });
  }, [activeClip, phase.kind, local, playing, rate, steps]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl bg-[#0f1c27]">
      {steps.map((s, i) => (
        <video
          key={`${version.version}-${i}`}
          ref={(el) => {
            refs.current[i] = el;
          }}
          src={s.clip.src}
          muted
          playsInline
          preload="auto"
          className={cx(
            "absolute inset-0 h-full w-full object-contain transition-opacity duration-200",
            i !== activeClip ? "opacity-0" : phase.kind === "plan" ? "opacity-60 blur-[1px]" : "opacity-100",
          )}
        />
      ))}

      {phase.kind === "plan" && <PlanOverlay version={version} p={p} />}

      <div className="absolute top-4 left-4 flex items-center gap-2 rounded-lg bg-black/45 px-3 py-1.5 text-[0.8rem] text-white backdrop-blur">
        <span className="font-mono font-semibold">v{version.version}</span>
        <span className="text-white/60">·</span>
        <span>{story.order.id === "STORY" ? "Story order" : story.order.id}</span>
        <span className="text-white/60">·</span>
        <span className="tabular">{phaseLabel(phase, steps.length)}</span>
      </div>

      <StepCard version={version} phase={phase} p={p} story={story} />
      <ResultCard version={version} phase={phase} p={p} />
    </div>
  );
}

function phaseLabel(phase: Phase, n: number): string {
  if (phase.kind === "plan") return "planning";
  if (phase.kind === "verify") return "verifying";
  return `item ${phase.step + 1} of ${n}`;
}

// ---------- plan: the coder writes pack(api) ----------

function PlanOverlay({ version, p }: { version: Version; p: number }) {
  const { plan } = version.run;
  const typed = Math.min(1, Math.max(0, (p - 0.12) / 0.62));
  const code = plan.code.slice(0, Math.round(plan.code.length * typed));
  const done = typed >= 1;
  return (
    <div className="absolute inset-y-0 left-0 flex w-[58%] flex-col justify-center gap-3 p-8">
      <div className="animate-enter flex flex-wrap gap-2 text-[0.75rem]">
        <ContextChip icon="box" label={`${version.run.steps.length} items, 18 s budget`} />
        <ContextChip
          icon="db"
          label={`${plan.retrieved.skills.length} skills, ${plan.retrieved.lessons.length} lessons`}
          muted={!plan.retrieved.skills.length && !plan.retrieved.lessons.length}
        />
        <ContextChip icon="scale" label={plan.tool_calls.length ? `${plan.tool_calls.length} tool calls` : "no tools"} muted={!plan.tool_calls.length} />
      </div>
      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0b141c]/90 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2 text-[0.75rem] text-white/60">
          <Icon name="code" size={14} />
          <span>{plan.model} writes the packing program</span>
          {!done && <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-[#7aa2ff]" />}
          {done && <span className="ml-auto text-[#7be3a0]">sandbox ok</span>}
        </div>
        <pre className="min-h-[11rem] px-4 py-3 font-mono text-[0.82rem] leading-relaxed text-[#dfe7ef]">
          <Highlighted code={code} />
          {!done && <span className="animate-caret text-[#7aa2ff]">▍</span>}
        </pre>
      </div>
      {done && (
        <div className="animate-enter flex flex-wrap items-center gap-2 text-[0.75rem] text-white/80">
          <span className="text-white/50">→ actions</span>
          {version.run.steps.map((s, i) => (
            <span key={i} className="rounded-md bg-white/10 px-2 py-1 font-mono">
              {s.item.product_id} {s.action.grip}/{s.action.speed} → {s.action.slot}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ContextChip({ icon, label, muted }: { icon: "box" | "db" | "scale"; label: string; muted?: boolean }) {
  return (
    <span
      className={cx(
        "flex items-center gap-1.5 rounded-full px-2.5 py-1",
        muted ? "bg-white/5 text-white/45" : "bg-white/12 text-white",
      )}
    >
      <Icon name={icon} size={13} />
      {label}
    </span>
  );
}

/** tiny python highlighter: comments, strings, keywords */
function Highlighted({ code }: { code: string }) {
  const parts = code.split(/(#[^\n]*|'[^'\n]*'?|\b(?:def|for|in|return|if|else)\b)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        if (part.startsWith("#")) return <span key={i} className="text-[#7d8b99] italic">{part}</span>;
        if (part.startsWith("'")) return <span key={i} className="text-[#a5d6a7]">{part}</span>;
        if (/^(def|for|in|return|if|else)$/.test(part)) return <span key={i} className="text-[#c792ea]">{part}</span>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ---------- overlay cards ----------

function Overlay({
  pos,
  eyebrow,
  children,
  tone = "neutral",
}: {
  pos: "top" | "bottom";
  eyebrow: React.ReactNode;
  children: React.ReactNode;
  tone?: "neutral" | "ok" | "bad";
}) {
  return (
    <div
      className={cx(
        "absolute right-4 w-[min(23rem,40%)] rounded-xl border bg-surface/97 p-4 shadow-xl backdrop-blur",
        pos === "top" ? "top-4" : "bottom-4",
        tone === "ok" ? "border-ok/40" : tone === "bad" ? "border-bad/40" : "border-line",
      )}
    >
      <div className="mb-2 text-[0.68rem] font-medium tracking-wide text-mute uppercase">{eyebrow}</div>
      {children}
    </div>
  );
}

function KV({ k, v, accent }: { k: string; v: React.ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-[0.85rem]">
      <span className="text-mute">{k}</span>
      <span className={cx("text-right font-mono", accent ? "font-semibold text-ink" : "text-ink-2")}>{v}</span>
    </div>
  );
}

const WHY_LABEL = {
  skill: "Skill from memory",
  lesson: "Lesson from memory",
  tool: "Tool reading",
  guess: "Coder's guess",
  default: "Harness default",
} as const;

function StepCard({ version, phase, p, story }: { version: Version; phase: Phase; p: number; story: Story }) {
  const { plan, steps, verify } = version.run;
  if (phase.kind === "plan") {
    return (
      <Overlay pos="top" eyebrow="Current step · plan">
        <div className="text-[1rem] font-semibold">Coder writes the program</div>
        <div className="mt-2">
          <KV k="Model" v={plan.model} />
          <KV k="Skills retrieved" v={plan.retrieved.skills.length} accent={plan.retrieved.skills.length > 0} />
          <KV k="Lessons retrieved" v={plan.retrieved.lessons.length} accent={plan.retrieved.lessons.length > 0} />
          <KV k="Budget" v={`${story.objective.time_budget_s} s`} />
        </div>
        {plan.gaps.length > 0 && p > 0.5 && (
          <div className="animate-enter mt-2 rounded-md bg-sunk px-2.5 py-1.5 text-[0.75rem] leading-snug text-ink-2">
            <span className="font-medium">Coder flagged: </span>
            {plan.gaps[0]}
          </div>
        )}
      </Overlay>
    );
  }
  if (phase.kind === "verify") {
    return (
      <Overlay pos="top" eyebrow="Current step · verify">
        <div className="text-[1rem] font-semibold">Referee totals the order</div>
        <div className="mt-2">
          <KV k="Damage-free" v={`${verify.damage_free} / ${verify.n_items}`} accent />
          <KV k="Cycle time" v={`${verify.cycle_s.toFixed(1)} s of ${story.objective.time_budget_s} s`} />
        </div>
      </Overlay>
    );
  }
  const s = steps[phase.step];
  const why = s.why;
  return (
    <Overlay
      pos="top"
      eyebrow={
        <>
          Current step · {s.kind === "recover" ? "recover" : "place"} {phase.step + 1}/{steps.length}
        </>
      }
    >
      <div className="text-[1rem] font-semibold">{s.item.label}</div>
      <div className="mt-2">
        <KV k="Grip" v={fmtGrip(s.action)} accent />
        <KV k="Speed" v={fmtSpeed(s.action)} accent />
        <KV k="Slot" v={s.action.on_top_of ? `${s.action.slot}, on ${s.action.on_top_of}` : s.action.slot} />
      </div>
      <div
        className={cx(
          "mt-2.5 rounded-md px-2.5 py-1.5 text-[0.75rem] leading-snug",
          why.source === "guess" ? "bg-sunk text-ink-2" : "bg-accent-soft text-ink-2",
        )}
      >
        <span className={cx("font-medium", why.source === "guess" ? "text-mute" : "text-accent")}>
          Why: {WHY_LABEL[why.source]}.
        </span>{" "}
        {why.text}
      </div>
      <Progress p={p} />
    </Overlay>
  );
}

function Progress({ p }: { p: number }) {
  return (
    <div className="mt-3 h-1 overflow-hidden rounded-full bg-sunk">
      <div className="h-full bg-accent" style={{ width: `${Math.min(100, p * 100)}%` }} />
    </div>
  );
}

function ResultCard({ version, phase, p }: { version: Version; phase: Phase; p: number }) {
  const { steps, verify } = version.run;
  if (phase.kind === "plan") return null;
  if (phase.kind === "verify") {
    const allOk = verify.damage_free === verify.n_items;
    return (
      <Overlay pos="bottom" eyebrow="Result signals → Raindrop" tone={allOk ? "ok" : "bad"}>
        <div className="flex items-baseline gap-2">
          <span className={cx("text-[1.6rem] font-semibold tabular", allOk ? "text-ok" : "text-bad")}>
            {verify.damage_free}/{verify.n_items}
          </span>
          <span className="text-[0.85rem] text-mute">damage-free in {verify.cycle_s.toFixed(1)} s</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {verify.signals.map((sg, i) => (
            <span
              key={i}
              style={{ animationDelay: `${i * 120}ms` }}
              className={cx(
                "animate-enter rounded-md px-2 py-1 text-[0.72rem]",
                sg.polarity === "positive"
                  ? "bg-ok-soft text-ok"
                  : sg.polarity === "negative"
                    ? "bg-bad-soft text-bad"
                    : "bg-sunk text-ink-2",
              )}
            >
              <span className="font-medium">{sg.name}</span>
              {sg.item && <span className="opacity-75"> · {sg.item}</span>}
            </span>
          ))}
        </div>
      </Overlay>
    );
  }
  // place: results so far, current one revealed near the end of its clip
  const shown = steps
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => i < phase.step || (i === phase.step && p >= RESULT_AT));
  const current = steps[phase.step];
  const currentShown = p >= RESULT_AT;
  return (
    <Overlay
      pos="bottom"
      eyebrow="Result"
      tone={currentShown ? (current.result.ok ? "ok" : "bad") : "neutral"}
    >
      {currentShown ? (
        <div className="animate-enter">
          <div className={cx("flex items-center gap-2 text-[1.05rem] font-semibold", current.result.ok ? "text-ok" : "text-bad")}>
            <Icon name={current.result.ok ? "check" : "x"} size={18} />
            {current.result.ok ? "Packed clean" : FAMILY_LABEL[current.result.family ?? "crush"]}
          </div>
          <div className="mt-0.5 text-[0.8rem] text-ink-2">
            {current.result.ok ? current.item.label : current.result.detail}
          </div>
          {current.result.peak_N != null && (
            <div className="mt-1 font-mono text-[0.72rem] text-mute">peak finger force {current.result.peak_N} N</div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[0.9rem] text-mute">
          <span className="h-2 w-2 animate-pulse-dot rounded-full bg-accent" />
          Physics running, referee watching
        </div>
      )}
      {shown.length > (currentShown ? 1 : 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-2.5">
          {shown
            .filter(({ i }) => i !== phase.step)
            .map(({ s, i }) => (
              <span
                key={i}
                className={cx(
                  "rounded-md px-2 py-0.5 text-[0.7rem]",
                  s.result.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad",
                )}
              >
                {s.item.product_id} {s.result.ok ? "clean" : FAMILY_LABEL[s.result.family ?? "crush"].toLowerCase()}
              </span>
            ))}
        </div>
      )}
    </Overlay>
  );
}

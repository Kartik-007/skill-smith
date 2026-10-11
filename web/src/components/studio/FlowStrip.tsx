"use client";

import { useEffect, useRef, useState } from "react";
import type { Phase } from "@/lib/story/timeline";
import type { Story, Version } from "@/lib/story/types";
import { cx, FAMILY_LABEL, fmtGrip, fmtSpeed } from "./format";
import { Icon, type IconName } from "./icons";

type NodeId = "order" | "memory" | "coder" | "sandbox" | "physics" | "referee" | "signals";

const NODES: { id: NodeId; label: string; sub: string; icon: IconName }[] = [
  { id: "order", label: "Order", sub: "items + budget", icon: "box" },
  { id: "memory", label: "Memory", sub: "Atlas Vector Search", icon: "db" },
  { id: "coder", label: "Coder", sub: "writes pack(api)", icon: "code" },
  { id: "sandbox", label: "Sandbox", sub: "program → actions", icon: "shield" },
  { id: "physics", label: "Physics", sub: "MuJoCo pick + place", icon: "cube" },
  { id: "referee", label: "Referee", sub: "hidden physics truth", icon: "gavel" },
  { id: "signals", label: "Signals", sub: "Raindrop", icon: "drop" },
];

/** which node the run is "in" right now */
function activeNode(phase: Phase, p: number): NodeId {
  if (phase.kind === "plan") return p < 0.06 ? "order" : p < 0.14 ? "memory" : p < 0.76 ? "coder" : "sandbox";
  if (phase.kind === "place") return p < 0.82 ? "physics" : "referee";
  return "signals";
}

export function FlowStrip({
  story,
  version,
  phase,
  p,
}: {
  story: Story;
  version: Version;
  phase: Phase;
  p: number;
}) {
  const active = activeNode(phase, p);
  const activeIdx = NODES.findIndex((n) => n.id === active);
  const [open, setOpen] = useState<NodeId | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {open && (
        <div className="card animate-enter absolute right-0 bottom-full left-0 z-20 mb-2 max-h-[22rem] overflow-y-auto p-5">
          <NodeDetail id={open} story={story} version={version} phase={phase} />
        </div>
      )}
      <div className="card flex items-stretch px-2 py-2">
        {NODES.map((n, i) => {
          const isActive = i === activeIdx;
          // during place steps the plan nodes are done; physics/referee loop per item
          const done = i < activeIdx;
          return (
            <div key={n.id} className="flex min-w-0 flex-1 items-center">
              <button
                type="button"
                onClick={() => setOpen((o) => (o === n.id ? null : n.id))}
                className={cx(
                  "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all",
                  isActive ? "bg-accent text-white shadow-md" : open === n.id ? "bg-sunk" : "hover:bg-sunk",
                )}
              >
                <span
                  className={cx(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-md",
                    isActive ? "bg-white/20" : done ? "bg-accent-soft text-accent" : "bg-sunk text-mute",
                  )}
                >
                  <Icon name={n.icon} size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[0.82rem] font-medium">{n.label}</span>
                  <span className={cx("block truncate text-[0.68rem]", isActive ? "text-white/75" : "text-mute")}>
                    {n.sub}
                  </span>
                </span>
              </button>
              {i < NODES.length - 1 && (
                <span className={cx("px-0.5 text-[0.9rem]", i < activeIdx ? "text-accent" : "text-line-2")}>›</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function H({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <h3 className="text-[0.95rem] font-semibold">{children}</h3>
      {sub && <span className="text-[0.75rem] text-mute">{sub}</span>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.8rem] text-mute">{children}</p>;
}

function NodeDetail({ id, story, version, phase }: { id: NodeId; story: Story; version: Version; phase: Phase }) {
  const { plan, steps, verify } = version.run;
  switch (id) {
    case "order":
      return (
        <>
          <H sub={`${story.order.id} · ${story.objective.customer}`}>Input order</H>
          <div className="grid grid-cols-3 gap-2">
            {story.order.items.map((it) => (
              <div key={it.id} className="rounded-lg border border-line px-3 py-2">
                <div className="font-mono text-[0.7rem] text-mute">{it.id}</div>
                <div className="text-[0.85rem]">{it.label}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[0.8rem] text-mute">
            Budget {story.objective.time_budget_s} s. Mass, friction and crush limits are hidden from the coder.
          </p>
        </>
      );
    case "memory":
      return (
        <>
          <H sub="what the harness let the coder see">Retrieved from Atlas Vector Search</H>
          {plan.retrieved.skills.length + plan.retrieved.lessons.length === 0 && (
            <Empty>Nothing. Retrieval is off at v{version.version} (skills_k = 0, lessons_k = 0).</Empty>
          )}
          <ul className="space-y-1.5">
            {plan.retrieved.skills.map((s, i) => (
              <li key={`s${i}`} className="flex gap-2 text-[0.8rem]">
                <span className="shrink-0 rounded bg-ok-soft px-1.5 py-0.5 text-[0.65rem] font-medium text-ok uppercase">skill</span>
                {s}
              </li>
            ))}
            {plan.retrieved.lessons.map((s, i) => (
              <li key={`l${i}`} className="flex gap-2 text-[0.8rem]">
                <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[0.65rem] font-medium text-accent uppercase">lesson</span>
                {s}
              </li>
            ))}
          </ul>
        </>
      );
    case "coder":
      return (
        <>
          <H sub={`${plan.model}, same model in every version`}>Program the coder wrote</H>
          <pre className="rounded-lg bg-[#0b141c] px-4 py-3 font-mono text-[0.78rem] leading-relaxed text-[#dfe7ef]">
            {plan.code}
          </pre>
          {plan.gaps.map((g, i) => (
            <p key={i} className="mt-2 text-[0.78rem] text-ink-2">
              <span className="font-medium">Capability gap: </span>
              {g}
            </p>
          ))}
        </>
      );
    case "sandbox":
      return (
        <>
          <H sub="restricted Python, recording API">Actions recorded</H>
          <table className="w-full text-[0.8rem]">
            <thead className="text-left text-mute">
              <tr>
                <th className="pb-1 font-normal">Item</th>
                <th className="pb-1 font-normal">Grip</th>
                <th className="pb-1 font-normal">Speed</th>
                <th className="pb-1 font-normal">Slot</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {steps.map((s, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1 font-sans">{s.item.label}</td>
                  <td>{fmtGrip(s.action)}</td>
                  <td>{fmtSpeed(s.action)}</td>
                  <td>{s.action.slot}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {plan.tool_calls.length > 0 && (
            <ul className="mt-3 space-y-1 font-mono text-[0.75rem]">
              {plan.tool_calls.map((c, i) => (
                <li key={i}>
                  {c.tool}({c.item}) → {c.result} <span className="text-mute">+{c.time_s} s</span>
                </li>
              ))}
            </ul>
          )}
        </>
      );
    case "physics":
    case "referee": {
      const current = phase.kind === "place" ? phase.step : -1;
      return (
        <>
          <H sub={id === "physics" ? "one checkpointed queue step per item" : "graded with hidden mass, friction, crush limit"}>
            {id === "physics" ? "Pick and place" : "Referee verdicts"}
          </H>
          <div className="space-y-1.5">
            {steps.map((s, i) => (
              <div
                key={i}
                className={cx(
                  "flex items-center gap-3 rounded-lg border px-3 py-2 text-[0.8rem]",
                  i === current ? "border-accent" : "border-line",
                )}
              >
                <span className="font-mono text-mute">{i + 1}</span>
                <span className="flex-1">{s.item.label}</span>
                <span className="font-mono text-[0.75rem] text-mute">
                  {fmtGrip(s.action)} · {fmtSpeed(s.action)}
                </span>
                <span
                  className={cx(
                    "w-28 rounded px-1.5 py-0.5 text-center text-[0.7rem]",
                    s.result.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad",
                  )}
                >
                  {s.result.ok ? "clean" : FAMILY_LABEL[s.result.family ?? "crush"]}
                  {s.result.peak_N != null && ` · ${s.result.peak_N} N`}
                </span>
              </div>
            ))}
          </div>
        </>
      );
    }
    case "signals":
      return (
        <>
          <H sub="one event per order, one signal per item">Sent to Raindrop</H>
          <div className="flex flex-wrap gap-1.5">
            {verify.signals.map((sg, i) => (
              <span
                key={i}
                className={cx(
                  "rounded-md px-2 py-1 text-[0.75rem]",
                  sg.polarity === "positive"
                    ? "bg-ok-soft text-ok"
                    : sg.polarity === "negative"
                      ? "bg-bad-soft text-bad"
                      : "bg-sunk text-ink-2",
                )}
              >
                {sg.name}
                {sg.item && ` · ${sg.item}`}
              </span>
            ))}
          </div>
          <p className="mt-3 text-[0.8rem] text-mute">The meta-agent reads these back before it changes the harness.</p>
        </>
      );
  }
}

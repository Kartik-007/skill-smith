"use client";

import { useEffect, useState } from "react";
import type { Genome } from "@/lib/story/types";
import { cx, fmtValue, humanKey } from "./format";
import { Icon } from "./icons";

export interface Change {
  /** dotted genome path, e.g. "retrieval.skills_k" */
  path: string;
  before: string;
  after: string;
  /** pending: the meta-agent proposed it and the gate hasn't ruled; applied: it's in this version */
  state: "pending" | "applied";
}

interface Row {
  key: string;
  label: string;
  value: string;
  mono?: boolean;
}

interface Section {
  id: string;
  label: string;
  summary: string;
  rows: Row[];
  locked?: boolean;
}

function sections(g: Genome): Section[] {
  const rec = (id: string, obj: Record<string, unknown>) =>
    Object.entries(obj).map(([k, v]) => ({ key: `${id}.${k}`, label: humanKey(k), value: fmtValue(v) }));
  const toolsOn = Object.entries(g.tools).filter(([, v]) => v);
  const helpers = g.helpers ?? [];
  const out: Section[] = [
    {
      id: "models",
      label: "Models",
      summary: `coder ${g.models.coder}`,
      rows: rec("models", g.models),
    },
    {
      id: "rules",
      label: "Rules",
      summary: g.rules.length ? `${g.rules.length}` : "none",
      rows: g.rules.length
        ? g.rules.map((r, i) => ({ key: `rules.${i}`, label: `${i + 1}`, value: r }))
        : [{ key: "rules", label: "", value: "No rules yet" }],
    },
    {
      id: "tools",
      label: "Tools",
      summary: toolsOn.length ? toolsOn.map(([k]) => k).join(", ") : "none on",
      rows: rec("tools", g.tools),
    },
    {
      id: "retrieval",
      label: "Memory",
      summary: `skills ${g.retrieval.skills_k ?? 0} · lessons ${g.retrieval.lessons_k ?? 0}`,
      rows: rec("retrieval", g.retrieval),
    },
    {
      id: "defaults",
      label: "Defaults",
      summary: Object.values(g.defaults).slice(0, 2).join(" · "),
      rows: rec("defaults", g.defaults),
    },
    {
      id: "retry",
      label: "Retry",
      summary: Object.values(g.retry).every((v) => !v) ? "off" : "on",
      rows: rec("retry", g.retry),
    },
    {
      id: "helpers",
      label: "Helpers",
      summary: helpers.length ? `${helpers.length}` : "none",
      rows: helpers.length
        ? helpers.map((h) => ({ key: `helpers.${h.name}`, label: h.name, value: h.code, mono: true }))
        : [{ key: "helpers", label: "", value: "No helper functions" }],
    },
  ];
  if (g.critic_focus !== undefined) {
    out.push({
      id: "critic_focus",
      label: "Critic focus",
      summary: g.critic_focus ? "set" : "none",
      rows: [{ key: "critic_focus", label: "", value: g.critic_focus || "Critic writes about any failure" }],
    });
  }
  out.push({
    id: "locked",
    label: "Guardrails",
    summary: "locked",
    locked: true,
    rows: rec("locked", g.locked),
  });
  return out;
}

export function HarnessPanel({
  version,
  genome,
  change,
}: {
  version: number;
  genome: Genome;
  change: Change | null;
}) {
  const secs = sections(genome);
  const changedSection = change ? change.path.split(".")[0] : null;
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // open the section that's changing, so the diff is visible without clicking
  useEffect(() => {
    if (changedSection) setOpen((o) => ({ ...o, [changedSection]: true }));
  }, [changedSection, change?.state]);

  return (
    <aside className="card flex min-h-0 flex-col overflow-hidden">
      <div className="border-b border-line px-5 pt-4 pb-3">
        <div className="flex items-center gap-2 text-[0.7rem] font-medium tracking-wide text-mute uppercase">
          <span className="inline-block h-2 w-2 rounded-full bg-accent" />
          Skill Smith
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <h2 className="text-[1.05rem] font-semibold">Harness config</h2>
          <span
            key={version}
            className="animate-enter rounded-md bg-ink px-2 py-0.5 font-mono text-[0.95rem] font-semibold text-white"
          >
            v{version}
          </span>
        </div>
        <p className="mt-1 text-[0.8rem] leading-snug text-mute">
          What the coder is given. The model never changes. This does.
        </p>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {secs.map((s) => {
          const isOpen = !!open[s.id];
          const hot = changedSection === s.id;
          return (
            <div key={s.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}
                className={cx(
                  "flex w-full items-center gap-2 px-5 py-3 text-left transition-colors hover:bg-sunk",
                  hot && "bg-change-soft hover:bg-change-soft",
                )}
              >
                {s.locked && <Icon name="lock" size={14} className="text-mute" />}
                <span className="text-[0.9rem] font-medium">{s.label}</span>
                {hot && <span className="h-1.5 w-1.5 rounded-full bg-change" />}
                <span
                  className={cx(
                    "ml-auto truncate pl-2 font-mono text-[0.75rem]",
                    hot ? "text-change" : "text-mute",
                  )}
                >
                  {s.summary}
                </span>
                <Icon
                  name="chevron"
                  size={14}
                  className={cx("shrink-0 text-faint transition-transform", isOpen && "rotate-180")}
                />
              </button>
              {isOpen && (
                <div className="animate-enter space-y-1 px-5 pb-3">
                  {s.rows.map((r) => {
                    const isChanged = change && r.key === change.path;
                    return (
                      <div
                        key={r.key}
                        className={cx(
                          "flex items-baseline gap-3 rounded-md px-2 py-1 text-[0.8rem]",
                          isChanged && "bg-change-soft ring-1 ring-change/30",
                        )}
                      >
                        {r.label && <span className="shrink-0 text-mute">{r.label}</span>}
                        {isChanged ? (
                          <span className="ml-auto flex items-baseline gap-1.5 font-mono">
                            {change.state === "pending" ? (
                              <>
                                <span className="text-mute line-through">{change.before}</span>
                                <span className="text-change">→</span>
                                <span className="font-semibold text-change">{change.after}</span>
                              </>
                            ) : (
                              <>
                                <span className="font-semibold text-change">{r.value}</span>
                                <span className="text-[0.7rem] text-change">was {change.before}</span>
                              </>
                            )}
                          </span>
                        ) : (
                          <span
                            className={cx(
                              "text-ink-2",
                              r.label ? "ml-auto text-right font-mono" : "text-mute",
                              r.mono && "font-mono whitespace-pre-wrap",
                            )}
                          >
                            {r.value}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

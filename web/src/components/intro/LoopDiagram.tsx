"use client";

import { Icon, type IconName } from "@/components/studio/icons";

// The one-glance picture of the system: a run loop inside the harness, and an evolve loop that rewrites it.
// Coordinates are in a fixed 1600×800 viewBox; the SVG scales to fit.

export type Build = "run" | "memory" | "evolve" | "loop";
const ORDER: Build[] = ["run", "memory", "evolve", "loop"];

export const S = 112; // node square
export const MONO = "var(--font-mono)";

export const C = {
  ink: "var(--color-ink)",
  ink2: "var(--color-ink-2)",
  mute: "var(--color-mute)",
  faint: "var(--color-faint)",
  line: "var(--color-line-2)",
  sunk: "var(--color-sunk)",
  surface: "var(--color-surface)",
  accent: "var(--color-accent)",
};

export function Node({
  x,
  y,
  icon,
  label,
  sub,
  accent,
}: {
  x: number;
  y: number;
  icon: IconName;
  label: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <g>
      <rect
        x={x - S / 2}
        y={y - S / 2}
        width={S}
        height={S}
        rx={6}
        fill={accent ? C.accent : C.sunk}
        stroke={accent ? C.accent : "var(--color-line)"}
      />
      <g transform={`translate(${x - 22},${y - 22})`} style={{ color: accent ? "#fff" : C.ink }}>
        <Icon name={icon} size={44} />
      </g>
      <text x={x} y={y + S / 2 + 34} textAnchor="middle" fontFamily={MONO} fontSize={19} letterSpacing="0.14em" fill={C.ink2}>
        {label}
      </text>
      <text x={x} y={y + S / 2 + 58} textAnchor="middle" fontFamily={MONO} fontSize={15} letterSpacing="0.08em" fill={C.mute}>
        {sub}
      </text>
    </g>
  );
}

export function Edge({ d, label, lx, ly, anchor = "middle", blue }: { d: string; label?: string; lx?: number; ly?: number; anchor?: "start" | "middle" | "end"; blue?: boolean }) {
  return (
    <g>
      <path d={d} fill="none" stroke={blue ? C.accent : C.line} strokeWidth={2} strokeDasharray="6 6" markerEnd={blue ? "url(#arrow-blue)" : "url(#arrow)"} />
      {label && (
        <text x={lx} y={ly} textAnchor={anchor} fontFamily={MONO} fontSize={15} letterSpacing="0.1em" fill={blue ? C.accent : C.mute}>
          {label}
        </text>
      )}
    </g>
  );
}

export function GroupLabel({ x, y, text, extra }: { x: number; y: number; text: string; extra?: React.ReactNode }) {
  const w = text.length * 13.5 + (extra ? 60 : 0) + 28;
  return (
    <g>
      <rect x={x - 14} y={y - 16} width={w} height={32} fill={C.surface} />
      <text x={x} y={y + 7} fontFamily={MONO} fontSize={20} letterSpacing="0.14em" fill={C.ink}>
        {text}
        {extra}
      </text>
    </g>
  );
}

export function LoopDiagram({ build, version }: { build: Build; version: number }) {
  const at = ORDER.indexOf(build);
  const show = (b: Build) => ({
    opacity: ORDER.indexOf(b) <= at ? 1 : 0,
    transition: "opacity 600ms ease",
  });
  const loop = build === "loop";

  return (
    <svg viewBox="0 0 1600 800" className="h-full w-full" role="img" aria-label="Skill Smith loop diagram">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="var(--color-line-2)" />
        </marker>
        <marker id="arrow-blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="var(--color-accent)" />
        </marker>
      </defs>

      {/* ---- loop: a pulse travels the whole cycle, under the nodes ---- */}
      {loop && (
        <g>
          <path d="M780 300 H1440 V640 H780 Z" fill="none" stroke={C.accent} strokeWidth={2.5} opacity={0.25} />
          <circle r={9} fill={C.accent}>
            <animateMotion dur="3.2s" repeatCount="indefinite" path="M780 300 H1440 V640 H780 Z" />
          </circle>
        </g>
      )}

      {/* ---- run: order → harness (coder) → robot → referee ---- */}
      <g style={show("run")}>
        <rect x={270} y={150} width={660} height={300} fill="none" stroke={C.line} strokeWidth={1.5} rx={4} />
        <GroupLabel
          x={292}
          y={150}
          text="HARNESS "
          extra={
            <tspan key={version} fill={C.accent}>
              V{version}
            </tspan>
          }
        />
        <Edge d="M186 300 H266" />
        <Edge d="M836 300 H1050" label="PROGRAM" lx={943} ly={284} />
        <Edge d="M1166 300 H1380" />
        <Node x={130} y={300} icon="box" label="ORDER" sub="3 SNACKS · 18 S" />
        <Node x={780} y={300} icon="code" label="CODER" sub="SAME MODEL, ALWAYS" />
        <Node x={1110} y={300} icon="arm" label="ROBOT" sub="MUJOCO PHYSICS" />
        <Node x={1440} y={300} icon="gavel" label="REFEREE" sub="HIDDEN PHYSICS" />
      </g>

      {/* ---- memory: referee writes skills and lessons, the coder reads them ---- */}
      <g style={show("memory")}>
        <Edge d="M1440 238 V80 H420 V238" label="WHAT WORKED · WHAT FAILED" lx={930} ly={66} />
        <Edge d="M476 300 H720" label="PRIOR SKILLS + LESSONS" lx={598} ly={284} blue />
        <Node x={420} y={300} icon="db" label="MEMORY" sub="ATLAS VECTOR SEARCH" />
      </g>

      {/* ---- evolve: signals → meta-agent → gate → new harness version ---- */}
      <g style={show("evolve")}>
        <rect x={690} y={530} width={850} height={250} fill="none" stroke={C.line} strokeWidth={1.5} strokeDasharray="4 6" rx={4} />
        <GroupLabel x={712} y={530} text="EVOLVE" />
        <Edge d="M1440 430 V580" label="CRUSHED · SLIPPED · CLEAN" lx={1424} ly={500} anchor="end" />
        <Edge d="M1384 640 H1170" label="READS" lx={1277} ly={624} />
        <Edge d="M1054 640 H840" label="ONE CHANGE" lx={947} ly={624} />
        <Edge d="M780 584 V455" label="KEPT ONLY IF BETTER" lx={796} ly={505} anchor="start" blue={loop} />
        <Node x={1440} y={640} icon="drop" label="SIGNALS" sub="RAINDROP" />
        <Node x={1110} y={640} icon="brain" label="META-AGENT" sub="REWRITES HARNESS" accent />
        <Node x={780} y={640} icon="shield" label="GATE" sub="SCORES MUST RISE" />
      </g>

    </svg>
  );
}

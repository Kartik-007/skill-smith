"use client";

import { C, Edge, GroupLabel, MONO, Node, S } from "./LoopDiagram";

// Durable execution, drawn like the loop diagram. Numbers are from the recorded kill -9 demo (v2 harness, story
// order): checkpoint 1 at sim time 6.28 s, 8 s lease, attempt 2, pixel diff 0, order finished 3/3.

export type DurableBuild = "commit" | "kill" | "resume";
const ORDER: DurableBuild[] = ["commit", "kill", "resume"];
const BAD = "var(--color-bad)";

export function DurableDiagram({ build }: { build: DurableBuild }) {
  const at = ORDER.indexOf(build);
  const show = (b: DurableBuild) => ({
    opacity: ORDER.indexOf(b) <= at ? 1 : 0,
    transition: "opacity 600ms ease",
  });

  return (
    <svg viewBox="0 0 1600 800" className="h-full w-full" role="img" aria-label="Durable execution diagram">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="var(--color-line-2)" />
        </marker>
        <marker id="arrow-blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="var(--color-accent)" />
        </marker>
      </defs>

      {/* ---- commit: one order is a chain of leased steps; each finished step commits a checkpoint ---- */}
      <g style={show("commit")}>
        <rect x={60} y={150} width={1480} height={300} fill="none" stroke={C.line} strokeWidth={1.5} rx={4} />
        <GroupLabel x={82} y={150} text="WORK QUEUE IN ATLAS" />
        <Edge d="M226 290 H420" />
        <Edge d="M536 290 H730" />
        <Edge d="M846 290 H1040" />
        <Edge d="M1156 290 H1350" />
        <Node x={170} y={290} icon="code" label="PLAN" sub="CODER WRITES PACK()" />
        <Node x={480} y={290} icon="arm" label="PLACE 1" sub="CUPCAKES" />
        <Node x={790} y={290} icon="arm" label="PLACE 2" sub="CEREAL" />
        <Node x={1100} y={290} icon="arm" label="PLACE 3" sub="NESQUIK" />
        <Node x={1410} y={290} icon="gavel" label="VERIFY" sub="REFEREE TOTALS" />
        <Edge d="M480 420 V590" label="COMMIT: RESULT + PHYSICS STATE" lx={464} ly={512} anchor="end" />
        <Node x={480} y={650} icon="db" label="CHECKPOINT 1" sub="T = 6.28 S" />
      </g>

      {/* ---- kill: the worker dies mid-step; nothing from the half-done step commits ---- */}
      <g style={show("kill")}>
        <rect
          x={790 - S / 2 - 8}
          y={290 - S / 2 - 8}
          width={S + 16}
          height={S + 16}
          rx={8}
          fill="none"
          stroke={BAD}
          strokeWidth={3}
        />
        <text x={790} y={208} textAnchor="middle" fontFamily={MONO} fontSize={18} letterSpacing="0.14em" fill={BAD}>
          KILL -9 · LEASE EXPIRES IN 8 S
        </text>
      </g>

      {/* ---- resume: a new worker claims the step and restores the checkpoint ---- */}
      <g style={show("resume")}>
        <Edge d="M536 650 H730" label="RESTORE" lx={633} ly={634} blue />
        <Edge d="M790 590 V424" label="SAME STATE · PIXEL DIFF 0" lx={806} ly={512} anchor="start" blue />
        <Node x={790} y={650} icon="cube" label="NEW WORKER" sub="ATTEMPT 2" accent />
        <text x={1410} y={530} textAnchor="middle" fontFamily={MONO} fontSize={20} letterSpacing="0.14em" fill={C.accent}>
          ORDER DONE · 3/3
        </text>
      </g>
    </svg>
  );
}

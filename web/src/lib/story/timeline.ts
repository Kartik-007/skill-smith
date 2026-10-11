import type { Story } from "./types";

// The whole story is one clock: run v0 → meta → run v1 → meta → run v2. Every panel derives what to show from a
// single time `t`, so autoplay and scrubbing are the same thing.

export const PLAN_S = 8;
export const VERIFY_S = 5;
/** seconds per meta-agent state: signals, hypothesis, patch, gate, verdict */
export const META_STATE_S = [3.5, 4.5, 4.5, 5, 3.5] as const;
export const META_STATES = ["Read signals", "Hypothesis", "One patch", "Gate", "Verdict"] as const;
/** index of each meta-agent state, so callers don't hard-code positions */
export const META = { signals: 0, hypothesis: 1, patch: 2, gate: 3, verdict: 4 } as const;

export type PhaseKind = "plan" | "place" | "verify";

export interface Phase {
  kind: PhaseKind;
  /** index into run.steps for place phases */
  step: number;
  start: number;
  dur: number;
}

export type Segment =
  | { kind: "run"; vi: number; start: number; dur: number; phases: Phase[] }
  | { kind: "meta"; ti: number; start: number; dur: number; states: { start: number; dur: number }[] };

export interface Timeline {
  segments: Segment[];
  total: number;
}

export function buildTimeline(story: Story): Timeline {
  const segments: Segment[] = [];
  let t = 0;
  story.versions.forEach((v, vi) => {
    const start = t;
    const phases: Phase[] = [{ kind: "plan", step: -1, start: t, dur: PLAN_S }];
    t += PLAN_S;
    v.run.steps.forEach((s, i) => {
      phases.push({ kind: "place", step: i, start: t, dur: s.clip.duration_s });
      t += s.clip.duration_s;
    });
    phases.push({ kind: "verify", step: -1, start: t, dur: VERIFY_S });
    t += VERIFY_S;
    segments.push({ kind: "run", vi, start, dur: t - start, phases });

    if (vi < story.transitions.length) {
      const mStart = t;
      const states = META_STATE_S.map((d) => {
        const s = { start: t, dur: d };
        t += d;
        return s;
      });
      segments.push({ kind: "meta", ti: vi, start: mStart, dur: t - mStart, states });
    }
  });
  return { segments, total: t };
}

export type Cursor =
  | { kind: "run"; si: number; vi: number; phase: Phase; local: number; p: number }
  | { kind: "meta"; si: number; ti: number; state: number; local: number; p: number };

/** Where the story is at time t. `local` is seconds into the current phase/state, `p` its 0-1 progress. */
export function locate(tl: Timeline, t: number): Cursor {
  const clamped = Math.max(0, Math.min(t, tl.total - 1e-6));
  const si = Math.max(
    0,
    tl.segments.findIndex((s) => clamped >= s.start && clamped < s.start + s.dur),
  );
  const seg = tl.segments[si];
  if (seg.kind === "run") {
    const phase = seg.phases.find((p) => clamped < p.start + p.dur) ?? seg.phases[seg.phases.length - 1];
    const local = clamped - phase.start;
    return { kind: "run", si, vi: seg.vi, phase, local, p: local / phase.dur };
  }
  let state = seg.states.findIndex((s) => clamped < s.start + s.dur);
  if (state < 0) state = seg.states.length - 1;
  const local = clamped - seg.states[state].start;
  return { kind: "meta", si, ti: seg.ti, state, local, p: local / seg.states[state].dur };
}

/** Version whose harness is "current" at this cursor: during a meta segment it flips once the verdict lands. */
export function harnessVersionIndex(c: Cursor, story: Story): number {
  if (c.kind === "run") return c.vi;
  const tr = story.transitions[c.ti];
  const flipped = c.state >= META.verdict && tr.verdict.status === "kept";
  return flipped ? c.ti + 1 : c.ti;
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

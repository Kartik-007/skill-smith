// The story the screen plays: one order packed by each kept harness version, with the meta-agent's work between
// versions. Mock data (mock.ts) fills this today; the core will fill the same shape from Atlas later.
// Fields marked "v2" are optional so recorded v1 data (grip levels, 3 items, no tool loop) still fits.

export type Family = "crush" | "slip" | "collision" | "tip" | "in_box" | "over_budget" | "ordering";

export interface Objective {
  title: string;
  customer: string;
  time_budget_s: number;
  /** what "solved" means, one line */
  goal: string;
}

export interface OrderItem {
  id: string;
  product_id: string;
  label: string;
}

/** The harness config (core genome.py). Rendered generically, so new v2 knobs show up without UI changes. */
export interface Genome {
  models: Record<string, string>;
  rules: string[];
  tools: Record<string, boolean>;
  retrieval: Record<string, number>;
  defaults: Record<string, string | number>;
  retry: Record<string, number>;
  /** v2: pure helper functions injected into the coder's sandbox */
  helpers?: { name: string; code: string }[];
  /** v2: what the critic should write lessons about */
  critic_focus?: string | null;
  locked: Record<string, string | number>;
}

export interface ToolCall {
  tool: string;
  item: string;
  result: string;
  time_s: number;
}

export interface Plan {
  model: string;
  code: string;
  retrieved: { skills: string[]; lessons: string[] };
  tool_calls: ToolCall[];
  /** capability gaps the coder reported */
  gaps: string[];
}

export interface Action {
  grip: string;
  /** v2: continuous grip per finger */
  grip_N?: number;
  speed: string;
  /** v2: continuous speed */
  speed_mps?: number;
  slot: string;
  /** v2: stacking */
  on_top_of?: string | null;
}

export interface ItemResult {
  ok: boolean;
  family: Family | null;
  detail: string;
  peak_N: number | null;
  tilt_deg: number | null;
}

export interface Step {
  /** v2 adds "recover" steps after a slip */
  kind: "place" | "recover";
  item: OrderItem;
  action: Action;
  /** where the choice came from: a retrieved skill or lesson, a tool reading, or the coder's own guess */
  why: { source: "skill" | "lesson" | "tool" | "guess" | "default"; text: string };
  clip: { src: string; duration_s: number };
  result: ItemResult;
}

export interface Signal {
  name: string;
  item: string | null;
  polarity: "negative" | "positive" | "feedback";
}

export interface Run {
  id: string;
  plan: Plan;
  steps: Step[];
  verify: {
    damage_free: number;
    n_items: number;
    cycle_s: number;
    signals: Signal[];
  };
}

export interface Scores {
  T: number;
  H: number;
  cycle_s: number;
  cost_usd: number;
  by_family: Partial<Record<Family, number>>;
}

export interface Version {
  version: number;
  /** short one-liner, e.g. "set_retrieval skills_k=3" */
  patch_text: string;
  genome: Genome;
  scores: Scores;
  run: Run;
}

// ---- meta-agent transition (between versions[i] and versions[i+1]) ----

export interface InvestigateCall {
  tool: string;
  args: string;
  result: string;
  source: "raindrop" | "atlas";
}

export interface Guardrail {
  name: string;
  ok: boolean;
  detail: string;
}

export interface Transition {
  from: number;
  to: number;
  model: string;
  /** true when the investigation calls are illustrative (no recorded transcript yet) */
  sample?: boolean;
  signals: {
    source: "raindrop" | "atlas";
    failures: { family: Family; label: string; count: number }[];
    memory: { skills: number; lessons: number };
  };
  investigate: InvestigateCall[];
  hypothesis: string;
  patch: {
    op: string;
    /** dotted genome path that changes, e.g. "retrieval.skills_k" */
    path: string;
    before: string;
    after: string;
    rationale: string;
    predicted_effect: string;
  };
  gate: {
    T: [number, number];
    H: [number, number];
    p_better: number;
    guardrails: Guardrail[];
  };
  verdict: { status: "kept" | "rolled_back" | "rejected"; reason: string };
  cost_usd: number;
}

export interface Story {
  source: "mock" | "db";
  objective: Objective;
  order: { id: string; items: OrderItem[] };
  versions: Version[];
  transitions: Transition[];
}

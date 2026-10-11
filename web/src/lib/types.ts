// Shape of GET /api/state. replay.json uses the same shape (or an array of these, played back 1 frame/s).

export type Family = "crush" | "slip" | "collision" | "tip" | "in_box" | "over_budget";

export type VersionStatus = "running" | "kept" | "rolled_back" | "rejected" | "baseline";

export type FeedType =
  | "signal"
  | "gap"
  | "patch"
  | "verdict"
  | "recovery"
  | "tripwire"
  | "lesson"
  | "skill"
  | "info";

export type StepKind = "plan" | "place" | "verify";
export type StepStatus = "pending" | "leased" | "done" | "failed";

export interface Scores {
  T?: number | null;
  H?: number | null;
  F?: number | null;
  by_family?: Partial<Record<Family, number>>;
  cycle_s?: number | null;
  cost_usd?: number | null;
  p_better?: number | null;
  delta_T?: number | null;
  delta_H?: number | null;
}

export interface HarnessVersion {
  version: number;
  parent: number | null;
  status: VersionStatus;
  patch: { op: string; args: Record<string, unknown> } | null;
  patch_text: string;
  rationale: string;
  predicted_effect: string;
  verdict: string | null;
  verdict_reason: string;
  scores: Scores | null;
  models: { coder?: string; critic?: string; meta?: string } | null;
  created_at: string | null;
  finished_at: string | null;
}

export interface FeedItem {
  id: string;
  ts: string;
  type: FeedType;
  text: string;
  refs: Record<string, unknown>;
}

export interface QueueStep {
  id: string;
  step_idx: number;
  kind: StepKind;
  label: string | null;
  /** product being placed (place steps), when known */
  product_id: string | null;
  status: StepStatus;
  attempts: number;
  owner: string | null;
  lease_expires_at: string | null;
  lease_remaining_s: number | null;
  updated_at: string | null;
}

export interface QueueOrder {
  order_run_id: string;
  order_id: string;
  version: number | null;
  repeat: number | null;
  steps: QueueStep[];
}

export interface QueueSnapshot {
  batch_id: string;
  version: number | null;
  kind: string;
  generation: number | null;
  status: string;
  n_steps: number;
  n_done: number;
  n_failed: number;
  workers: string[];
  orders: QueueOrder[];
}

export interface RunItem {
  id: string;
  label: string;
  product_id: string;
  ok: boolean;
  family: Family | null;
  detail: string;
  tilt_deg: number | null;
}

export interface RunSummary {
  id: string;
  batch_id: string | null;
  version: number | null;
  order_id: string;
  suite: string | null;
  customer: string | null;
  items: RunItem[];
  damage_free: number;
  n_items: number;
  cycle_s: number | null;
  cost_usd: number | null;
  video: string | null;
  /** latest checkpoint frame for this run (live runs before the video exists) */
  frame: string | null;
  status: string;
  created_at: string | null;
}

export interface Showcase {
  baseline: RunSummary | null;
  best: RunSummary | null;
  /** most recent judge-requested order, if any in the last ~20 minutes */
  live: RunSummary | null;
}

export interface Recovery {
  id: string;
  ts: string;
  text: string;
  order_run_id: string | null;
  step_idx: number | null;
  attempt: number | null;
  before_frame: string | null;
  after_frame: string | null;
  pixel_diff: number | null;
}

export interface ProductOption {
  id: string;
  label: string;
}

export interface LiveRequest {
  id: string;
  name: string;
  product_id: string;
  status: string;
  created_at: string | null;
}

export type Section = "versions" | "feed" | "queue" | "showcase" | "recoveries" | "products";

export interface AppState {
  now: string;
  source: "db" | "mock" | "replay";
  /** sections that fell back to mock data because their collection is empty */
  mocked: Section[];
  db_error: string | null;
  versions: HarnessVersion[];
  feed: FeedItem[];
  queue: QueueSnapshot | null;
  showcase: Showcase;
  recoveries: Recovery[];
  products: ProductOption[];
  live_requests: LiveRequest[];
}

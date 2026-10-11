// Sample data used when a collection is empty (or with ?mock=1). It tells the same story as the real run:
// v0 crushes cupcakes, the meta-agent turns on squeeze_test, the gate keeps what wins on held-out orders.
// The queue moves with the clock so the layout can be checked without a running worker.
import type {
  AppState,
  FeedItem,
  FeedType,
  HarnessVersion,
  ProductOption,
  QueueOrder,
  QueueSnapshot,
  Recovery,
  Showcase,
  StepKind,
} from "./types";

const PLACEHOLDER_VIDEO = "/placeholder/sample.mp4";
const PLACEHOLDER_FRAME = "/placeholder/frame.jpg";

const MODELS = {
  coder: "anthropic/claude-haiku-5.5",
  critic: "anthropic/claude-haiku-5.5",
  meta: "anthropic/claude-sonnet-5.5",
};

export const MOCK_PRODUCTS: ProductOption[] = [
  { id: "cupcakes", label: "Little Debbie chocolate cupcakes" },
  { id: "veggie_crackers", label: "Van's fire roasted veggie crackers" },
  { id: "nesquik", label: "Nesquik chocolate powder canister" },
  { id: "fondant", label: "Rolled fondant, 24 oz" },
  { id: "nips_peanut", label: "Nips peanut butter hard candy" },
  { id: "girl_scouts_pb", label: "Crunch Girl Scouts peanut butter creme bars" },
  { id: "cereal", label: "Van's honey nut crunch cereal" },
];

function iso(now: number, agoS: number): string {
  return new Date(now - agoS * 1000).toISOString();
}

function version(
  now: number,
  v: number,
  parent: number | null,
  status: HarnessVersion["status"],
  patchText: string,
  op: string | null,
  args: Record<string, unknown>,
  scores: HarnessVersion["scores"],
  verdictReason: string,
  agoS: number,
  rationale = "",
): HarnessVersion {
  const verdict = status === "baseline" || status === "running" ? null : status;
  return {
    version: v,
    parent,
    status,
    patch: op ? { op, args } : null,
    patch_text: patchText,
    rationale,
    predicted_effect: "",
    verdict,
    verdict_reason: verdictReason,
    scores,
    models: MODELS,
    created_at: iso(now, agoS),
    finished_at: status === "running" ? null : iso(now, agoS - 60),
  };
}

function mockVersions(now: number): HarnessVersion[] {
  return [
    version(now, 0, null, "baseline", "bare harness", null, {},
      { T: 58, H: 50, F: 33, by_family: { crush: 5, slip: 2, tip: 2 }, cycle_s: 17.8, cost_usd: 0.019 },
      "", 1500),
    version(now, 1, 0, "kept", "add_rule: grip thin cartons soft", "add_rule",
      { rule: "Grip thin cartons with 'soft', never 'firm'." },
      { T: 67, H: 61, by_family: { crush: 3, slip: 2, tip: 2 }, cycle_s: 17.5, cost_usd: 0.021, p_better: 0.94, delta_T: 9, delta_H: 11 },
      "Won the paired comparison on held-out orders (+11 pts, p_better 0.94).", 1320,
      "Crush is the top failure family and every crush was a thin carton."),
    version(now, 2, 1, "rolled_back", "set carry_height 120 → 60 mm", "set_default",
      { key: "carry_height_mm", value: 60 },
      { T: 63, H: 56, by_family: { crush: 3, collision: 3, tip: 2 }, cycle_s: 15.9, cost_usd: 0.021, p_better: 0.22, delta_T: -4, delta_H: -5 },
      "Lost on held-out: two new collisions with the box wall (p_better 0.22).", 1140),
    version(now, 3, 1, "kept", "enable_tool: squeeze_test", "enable_tool",
      { tool: "squeeze_test" },
      { T: 83, H: 78, by_family: { crush: 1, slip: 1, tip: 2 }, cycle_s: 18.9, cost_usd: 0.027, p_better: 0.98, delta_T: 16, delta_H: 17 },
      "Won the paired comparison on held-out orders (+17 pts, p_better 0.98).", 960,
      "The coder asked how soft items are. squeeze_test answers that before the grasp."),
    version(now, 4, 3, "rejected", "raise referee crush limit", "set_referee",
      { key: "crush_margin", value: 2.0 },
      null,
      "Patch targets the referee. Atlas denied the write (code 13). Edit locked.", 780),
    version(now, 5, 3, "rolled_back", "set speed: fast", "set_default",
      { key: "speed", value: "fast" },
      { T: 79, H: 72, by_family: { crush: 1, slip: 3, tip: 2 }, cycle_s: 13.1, cost_usd: 0.026, p_better: 0.12, delta_T: -4, delta_H: -6 },
      "Lost on held-out: the JarroSil bottle slipped on 3 of 6 orders (p_better 0.12).", 600),
    version(now, 6, 3, "kept", "add_rule: tall boxes upright", "add_rule",
      { rule: "Place tall boxes upright against the far wall of the box." },
      { T: 92, H: 89, F: 89, by_family: { crush: 1, tip: 0, slip: 1 }, cycle_s: 18.4, cost_usd: 0.028, p_better: 0.97, delta_T: 9, delta_H: 11 },
      "Won the paired comparison on held-out orders (+11 pts, p_better 0.97).", 420,
      "Tip clusters on tall narrow boxes; the coder never asked for upright placement."),
    version(now, 7, 6, "running", "retrieval: lessons_k 3 → 5", "set_retrieval",
      { key: "lessons_k", value: 5 }, null, "", 90),
  ];
}

function mockFeed(now: number): FeedItem[] {
  // chronological, oldest first; reversed at the end
  const items: [number, FeedType, string, Record<string, unknown>][] = [
    [1490, "info", "Night shift started: harness v0 on 6 held-out orders × 2 repeats", {}],
    [1400, "signal", "Raindrop: “crushed” up 3× on thin cartons (cupcakes, donut sticks, Momento)", { family: "crush" }],
    [1385, "gap", "Coder asked: “I can't tell how soft the donut sticks carton is.”", {}],
    [1370, "lesson", "Lesson saved: thin cartons crush above ~9 N, grip them soft", {}],
    [1330, "patch", "Meta-agent: add_rule “grip thin cartons soft” → v1", { version: 1 }],
    [1250, "verdict", "Gate: KEPT v1 · +11 pts held-out", { version: 1, verdict: "kept", delta_H: 11 }],
    [1150, "patch", "Meta-agent: set carry_height 120 → 60 mm → v2", { version: 2 }],
    [1060, "verdict", "Gate: ROLLED BACK v2 · −5 pts, 2 new wall collisions", { version: 2, verdict: "rolled_back", delta_H: -5 }],
    [1000, "signal", "Raindrop: “crushed” is still the top family on held-out cartons", { family: "crush" }],
    [985, "gap", "Coder asked: “Can I test how firm an item is before I grip it?”", {}],
    [970, "patch", "Meta-agent: enable_tool squeeze_test → v3", { version: 3 }],
    [880, "verdict", "Gate: KEPT v3 · +17 pts held-out", { version: 3, verdict: "kept", delta_H: 17 }],
    [860, "skill", "Skill saved: soft-carton pick (cupcakes, 3/3 clean)", {}],
    [790, "patch", "Meta-agent: raise the referee's crush limit → v4", { version: 4 }],
    [785, "tripwire", "Not authorized (code 13) · meta-agent tried to read skillsmith_truth", { code: 13 }],
    [780, "verdict", "Gate: REJECTED v4 · touched the referee, edit locked", { version: 4, verdict: "rejected" }],
    [700, "recovery", "Worker killed mid-order. Resumed H03 step 3 from its checkpoint · pixel diff 0", {
      order_run_id: "eval-g3:H03:1", step_idx: 3, attempt: 2,
      before_frame: PLACEHOLDER_FRAME, after_frame: PLACEHOLDER_FRAME, pixel_diff: 0,
    }],
    [610, "patch", "Meta-agent: set speed fast → v5", { version: 5 }],
    [530, "verdict", "Gate: ROLLED BACK v5 · −6 pts, bottle slipped", { version: 5, verdict: "rolled_back", delta_H: -6 }],
    [500, "signal", "Raindrop: “tipped” clusters on tall boxes (cereal, Girl Scouts bars)", { family: "tip" }],
    [430, "patch", "Meta-agent: add_rule “tall boxes upright” → v6", { version: 6 }],
    [340, "verdict", "Gate: KEPT v6 · +11 pts held-out", { version: 6, verdict: "kept", delta_H: 11 }],
    [330, "skill", "Skill saved: tall-box upright place (cereal, 3/3 clean)", {}],
    [95, "patch", "Meta-agent: retrieval lessons_k 3 → 5 → v7", { version: 7 }],
    [88, "info", "Evaluating v7: 6 held-out orders × 1 repeat", {}],
  ];
  return items
    .map(([ago, type, text, refs], i) => ({ id: `mock-feed-${i}`, ts: iso(now, ago), type, text, refs }))
    .reverse();
}

const ORDER_ITEMS: Record<string, string[]> = {
  H01: ["donut_sticks", "nips_rum", "cereal"],
  H02: ["jarrosil", "momento", "cupcakes"],
  H03: ["girl_scouts_caramel", "donut_sticks", "nesquik"],
  H04: ["nips_rum", "jarrosil", "fondant"],
  H05: ["momento", "girl_scouts_caramel", "nips_peanut"],
  H06: ["donut_sticks", "jarrosil", "momento"],
};

function mockQueue(now: number): QueueSnapshot {
  const t = Math.floor(now / 1000);
  const STEP_S = 7;
  const LEASE_S = 10;
  const CYCLE_S = 5 * STEP_S + 20;
  const phases = [52, 41, 30, 19, 8, 0];
  const batch = "eval-g7";
  const orders: QueueOrder[] = Object.entries(ORDER_ITEMS).map(([orderId, products], k) => {
    const e = (t + phases[k]) % CYCLE_S;
    const cur = Math.floor(e / STEP_S);
    const inStep = e % STEP_S;
    const kinds: [StepKind, string | null][] = [
      ["plan", null],
      ["place", products[0]],
      ["place", products[1]],
      ["place", products[2]],
      ["verify", null],
    ];
    const runId = `${batch}:${orderId}:1`;
    return {
      order_run_id: runId,
      order_id: orderId,
      version: 7,
      repeat: 1,
      steps: kinds.map(([kind, productId], i) => {
        const leased = i === cur;
        const status = i < cur ? "done" : leased ? "leased" : "pending";
        const recovered = k === 2 && i === 3 && cur >= 3;
        return {
          id: `${runId}:${i}`,
          step_idx: i,
          kind,
          label: null,
          product_id: productId,
          status,
          attempts: recovered ? 2 : leased || status === "done" ? 1 : 0,
          owner: leased ? (k % 2 ? "worker-b" : "worker-a") : null,
          lease_expires_at: leased ? iso(now, -(LEASE_S - inStep)) : null,
          lease_remaining_s: leased ? LEASE_S - inStep : null,
          updated_at: status === "pending" ? null : iso(now, leased ? inStep : (cur - i) * STEP_S),
        };
      }),
    };
  });
  const steps = orders.flatMap((o) => o.steps);
  return {
    batch_id: batch,
    version: 7,
    kind: "eval",
    generation: 7,
    status: "running",
    n_steps: steps.length,
    n_done: steps.filter((s) => s.status === "done").length,
    n_failed: 0,
    workers: ["worker-a", "worker-b"],
    orders,
  };
}

function mockShowcase(now: number): Showcase {
  const base = {
    batch_id: "showcase",
    order_id: "STORY",
    suite: "story",
    customer: "Dev Ittycheria",
    n_items: 3,
    video: PLACEHOLDER_VIDEO,
    frame: null,
    status: "done",
    created_at: iso(now, 300),
  };
  return {
    baseline: {
      ...base,
      id: "showcase:STORY:v0",
      version: 0,
      damage_free: 1,
      cycle_s: 17.9,
      cost_usd: 0.004,
      items: [
        { id: "i0", label: "Little Debbie chocolate cupcakes", product_id: "cupcakes", ok: false, family: "crush", detail: "squeezed too hard by the fingers", tilt_deg: 2 },
        { id: "i1", label: "Nesquik chocolate powder canister", product_id: "nesquik", ok: true, family: null, detail: "", tilt_deg: 1 },
        { id: "i2", label: "Van's honey nut crunch cereal", product_id: "cereal", ok: false, family: "tip", detail: "ended 64 degrees from upright", tilt_deg: 64 },
      ],
    },
    best: {
      ...base,
      id: "showcase:STORY:v6",
      version: 6,
      damage_free: 3,
      cycle_s: 18.6,
      cost_usd: 0.006,
      items: [
        { id: "i0", label: "Little Debbie chocolate cupcakes", product_id: "cupcakes", ok: true, family: null, detail: "", tilt_deg: 1 },
        { id: "i1", label: "Nesquik chocolate powder canister", product_id: "nesquik", ok: true, family: null, detail: "", tilt_deg: 0 },
        { id: "i2", label: "Van's honey nut crunch cereal", product_id: "cereal", ok: true, family: null, detail: "", tilt_deg: 3 },
      ],
    },
    live: null,
  };
}

function mockRecoveries(feed: FeedItem[]): Recovery[] {
  return feed
    .filter((f) => f.type === "recovery")
    .map((f) => ({
      id: f.id,
      ts: f.ts,
      text: f.text,
      order_run_id: (f.refs.order_run_id as string) ?? null,
      step_idx: (f.refs.step_idx as number) ?? null,
      attempt: (f.refs.attempt as number) ?? null,
      before_frame: (f.refs.before_frame as string) ?? null,
      after_frame: (f.refs.after_frame as string) ?? null,
      pixel_diff: (f.refs.pixel_diff as number) ?? null,
    }));
}

export function mockSections(nowMs: number) {
  const feed = mockFeed(nowMs);
  return {
    versions: mockVersions(nowMs),
    feed,
    queue: mockQueue(nowMs),
    showcase: mockShowcase(nowMs),
    recoveries: mockRecoveries(feed),
    products: MOCK_PRODUCTS,
  };
}

export function mockState(nowMs: number = Date.now()): AppState {
  return {
    now: new Date(nowMs).toISOString(),
    source: "mock",
    mocked: ["versions", "feed", "queue", "showcase", "recoveries", "products"],
    db_error: null,
    ...mockSections(nowMs),
    live_requests: [],
  };
}

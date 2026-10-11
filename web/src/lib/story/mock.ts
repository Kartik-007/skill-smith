import type { Genome, OrderItem, Story, Version } from "./types";

// Sample story built from the recorded v1 run in Atlas (db `skillsmith`): genomes, patches, rationales, gate
// numbers and the v0 / v2 story runs (code, actions, peak forces, clips) are real. Two things are not:
// - v1 never rendered the story order, so its run is assembled from real per-item clips (v0 clip 1, v2 clips 2-3).
// - The meta-agent's investigation calls are illustrative; the recorded run had no tool loop yet.

const CLIPS = "/videos/clips";
const v0clip = (n: number) => `${CLIPS}/show-STORY-v0-1791748521_STORY_v0_r0_${n}.mp4`;
const v2clip = (n: number) => `${CLIPS}/show-STORY-v2-1791748552_STORY_v2_r0_${n}.mp4`;

// calibrated per-finger force of each grip level, and speed of each level (core control.py)
const GRIP_N: Record<string, number> = { soft: 5, medium: 11, firm: 22, max: 47 };
const SPEED_MPS: Record<string, number> = { slow: 0.15, normal: 0.35, fast: 0.8 };
const act = (grip: string, speed: string, slot: string) => ({
  grip,
  grip_N: GRIP_N[grip],
  speed,
  speed_mps: SPEED_MPS[speed],
  slot,
});

const CUPCAKES: OrderItem = { id: "i0", product_id: "cupcakes", label: "Little Debbie cupcakes" };
const NESQUIK: OrderItem = { id: "i1", product_id: "nesquik", label: "Nesquik canister" };
const CEREAL: OrderItem = { id: "i2", product_id: "cereal", label: "Van's cereal" };

const SKILL = {
  cupcakes: "Little Debbie cupcakes: packed clean with grip='soft', speed='normal'.",
  cereal: "Van's honey nut cereal: packed clean with grip='soft', speed='normal'.",
  nesquik: "Nesquik canister: packed clean with grip='firm', speed='fast'.",
};
const LESSON = {
  carton:
    "Thin or tall cardboard cartons crush at medium grip and even at soft grip when fast. Use soft grip with normal speed.",
  canister:
    "Rigid canisters crush at medium grip when fast, and slip at medium grip too. Use a firm-but-not-max grip.",
};

const GENOME_V0: Genome = {
  models: { coder: "Haiku 5.5", critic: "Sonnet 5.5", meta: "Sonnet 5.5" },
  rules: [],
  tools: { weigh: false, squeeze_test: false },
  retrieval: { skills_k: 0, lessons_k: 0, min_score: 0.75 },
  defaults: { speed: "normal", carry_height_mm: 150 },
  retry: { max_retries: 0 },
  helpers: [],
  critic_focus: null,
  locked: { time_budget_s: 18, max_grip: "max", workspace: "table", referee: "v1" },
};
const withRetrieval = (g: Genome, r: Partial<Genome["retrieval"]>): Genome => ({
  ...g,
  retrieval: { ...g.retrieval, ...r } as Genome["retrieval"],
});
const GENOME_V1 = withRetrieval(GENOME_V0, { skills_k: 3 });
const GENOME_V2 = withRetrieval(GENOME_V1, { lessons_k: 2 });

const ok = (peak_N: number) => ({ ok: true, family: null, detail: "packed clean", peak_N, tilt_deg: 0 });

const V0: Version = {
  version: 0,
  patch_text: "baseline harness",
  genome: GENOME_V0,
  scores: {
    T: 29.2,
    H: 75.0,
    cycle_s: 13.13,
    cost_usd: 0.00031,
    by_family: { crush: 10.5, slip: 8.5, over_budget: 1.6, collision: 1.1 },
  },
  run: {
    id: "show-STORY-v0-1791748521:STORY:v0:r0",
    plan: {
      model: "Haiku 5.5",
      code: [
        "def pack(api):",
        "    grips = {'i0': 'soft', 'i1': 'medium', 'i2': 'soft'}",
        "    slots = ['S1', 'S2', 'S3']",
        "    for n, item in enumerate(api.items()):",
        "        iid = item['id']",
        "        api.pick(iid, grip=grips.get(iid, 'medium'), speed='fast')",
        "        api.place(iid, slots[n])",
      ].join("\n"),
      retrieved: { skills: [], lessons: [] },
      tool_calls: [],
      gaps: [],
    },
    steps: [
      {
        kind: "place",
        item: CUPCAKES,
        action: act("soft", "fast", "S1"),
        why: { source: "guess", text: "No memory at v0. Guessed soft and fast to fit 3 items in 18 s." },
        clip: { src: v0clip(1), duration_s: 4.46 },
        result: { ok: false, family: "crush", detail: "squeezed too hard by the fingers", peak_N: 22.8, tilt_deg: 90 },
      },
      {
        kind: "place",
        item: NESQUIK,
        action: act("medium", "fast", "S2"),
        why: { source: "guess", text: "No memory at v0. A canister seemed sturdy, so medium grip." },
        clip: { src: v0clip(2), duration_s: 4.63 },
        result: {
          ok: false,
          family: "collision",
          detail: "hit another product while carried (28 N)",
          peak_N: 19.8,
          tilt_deg: 0,
        },
      },
      {
        kind: "place",
        item: CEREAL,
        action: act("soft", "fast", "S3"),
        why: { source: "guess", text: "No memory at v0. Soft grip to protect the box." },
        clip: { src: v0clip(3), duration_s: 4.58 },
        result: { ok: false, family: "slip", detail: "slid out of the fingers while carried", peak_N: 6.3, tilt_deg: 90 },
      },
    ],
    verify: {
      damage_free: 0,
      n_items: 3,
      cycle_s: 11.85,
      signals: [
        { name: "Crushed", item: "Little Debbie cupcakes", polarity: "negative" },
        { name: "Collision", item: "Nesquik canister", polarity: "negative" },
        { name: "Slipped", item: "Van's cereal", polarity: "negative" },
      ],
    },
  },
};

const V1: Version = {
  version: 1,
  patch_text: "set_retrieval skills_k=3",
  genome: GENOME_V1,
  scores: {
    T: 77.1,
    H: 83.3,
    cycle_s: 12.0,
    cost_usd: 0.00033,
    by_family: { crush: 5.0, collision: 2.0, slip: 1.5 },
  },
  run: {
    id: "sample-STORY-v1",
    plan: {
      model: "Haiku 5.5",
      code: [
        "def pack(api):",
        "    # skills: cereal soft/normal, Nesquik firm/fast",
        "    api.pick('i0', grip='soft', speed='fast')",
        "    api.place('i0', 'S1')",
        "    api.pick('i2', grip='soft', speed='normal')",
        "    api.place('i2', 'S2')",
        "    api.pick('i1', grip='firm', speed='fast')",
        "    api.place('i1', 'S3')",
      ].join("\n"),
      retrieved: { skills: [SKILL.cereal, SKILL.nesquik], lessons: [] },
      tool_calls: [],
      gaps: ["No proven grip or speed for Little Debbie cupcakes; using soft grip, fast to save time."],
    },
    steps: [
      {
        kind: "place",
        item: CUPCAKES,
        action: act("soft", "fast", "S1"),
        why: { source: "guess", text: "No skill for cupcakes yet. Guessed soft, and fast to save time." },
        clip: { src: v0clip(1), duration_s: 4.46 },
        result: { ok: false, family: "crush", detail: "squeezed too hard by the fingers", peak_N: 22.8, tilt_deg: 90 },
      },
      {
        kind: "place",
        item: CEREAL,
        action: act("soft", "normal", "S2"),
        why: { source: "skill", text: SKILL.cereal },
        clip: { src: v2clip(2), duration_s: 7.21 },
        result: ok(5.0),
      },
      {
        kind: "place",
        item: NESQUIK,
        action: act("firm", "fast", "S3"),
        why: { source: "skill", text: SKILL.nesquik },
        clip: { src: v2clip(3), duration_s: 4.67 },
        result: ok(22.5),
      },
    ],
    verify: {
      damage_free: 2,
      n_items: 3,
      cycle_s: 16.3,
      signals: [
        { name: "Crushed", item: "Little Debbie cupcakes", polarity: "negative" },
        { name: "Packed clean", item: "Van's cereal", polarity: "positive" },
        { name: "Packed clean", item: "Nesquik canister", polarity: "positive" },
        { name: "Capability gap", item: "Little Debbie cupcakes", polarity: "feedback" },
      ],
    },
  },
};

const V2: Version = {
  version: 2,
  patch_text: "set_retrieval lessons_k=2",
  genome: GENOME_V2,
  scores: {
    T: 95.8,
    H: 88.9,
    cycle_s: 14.25,
    cost_usd: 0.00042,
    by_family: { crush: 2.0, collision: 1.0 },
  },
  run: {
    id: "show-STORY-v2-1791748552:STORY:v2:r0",
    plan: {
      model: "Haiku 5.5",
      code: [
        "def pack(api):",
        "    api.pick('i0', grip='soft', speed='normal')",
        "    api.place('i0', 'S1')",
        "    api.pick('i2', grip='soft', speed='normal')",
        "    api.place('i2', 'S2')",
        "    api.pick('i1', grip='firm', speed='fast')",
        "    api.place('i1', 'S3')",
      ].join("\n"),
      retrieved: { skills: [SKILL.nesquik, SKILL.cupcakes, SKILL.cereal], lessons: [LESSON.carton, LESSON.canister] },
      tool_calls: [],
      gaps: [],
    },
    steps: [
      {
        kind: "place",
        item: CUPCAKES,
        action: act("soft", "normal", "S1"),
        why: { source: "lesson", text: LESSON.carton },
        clip: { src: v2clip(1), duration_s: 6.67 },
        result: ok(5.1),
      },
      {
        kind: "place",
        item: CEREAL,
        action: act("soft", "normal", "S2"),
        why: { source: "skill", text: SKILL.cereal },
        clip: { src: v2clip(2), duration_s: 7.21 },
        result: ok(5.0),
      },
      {
        kind: "place",
        item: NESQUIK,
        action: act("firm", "fast", "S3"),
        why: { source: "skill", text: SKILL.nesquik },
        clip: { src: v2clip(3), duration_s: 4.67 },
        result: ok(22.5),
      },
    ],
    verify: {
      damage_free: 3,
      n_items: 3,
      cycle_s: 16.76,
      signals: [
        { name: "Packed clean", item: "Little Debbie cupcakes", polarity: "positive" },
        { name: "Packed clean", item: "Van's cereal", polarity: "positive" },
        { name: "Packed clean", item: "Nesquik canister", polarity: "positive" },
      ],
    },
  },
};

export const MOCK_STORY: Story = {
  source: "mock",
  objective: {
    title: "Pack Dev Ittycheria's snack box",
    customer: "Dev Ittycheria",
    time_budget_s: 18,
    goal: "3 snacks into the green box, nothing crushed, dropped or dented, under 18 s",
  },
  order: { id: "STORY", items: [CUPCAKES, NESQUIK, CEREAL] },
  versions: [V0, V1, V2],
  transitions: [
    {
      from: 0,
      to: 1,
      model: "Sonnet 5.5",
      sample: true,
      signals: {
        source: "raindrop",
        failures: [
          { family: "crush", label: "Crushed", count: 10.5 },
          { family: "slip", label: "Slipped", count: 8.5 },
          { family: "over_budget", label: "Over budget", count: 1.6 },
          { family: "collision", label: "Collision", count: 1.1 },
        ],
        memory: { skills: 9, lessons: 3 },
      },
      investigate: [
        { tool: "count_signal", args: "Crushed, v0, train", result: "21 of 48 items", source: "raindrop" },
        {
          tool: "find_events",
          args: "Crushed, v0, limit 3",
          result: "cupcakes ×2, veggie crackers: thin cartons moved fast",
          source: "raindrop",
        },
        {
          tool: "query_atlas",
          args: "memory {kind: skill, active: true}",
          result: "9 proven skills stored, 0 retrieved (skills_k = 0)",
          source: "atlas",
        },
        {
          tool: "list_gaps",
          args: "v0",
          result: "\"No orientation control\" ×3 (noise, items are set down upright)",
          source: "raindrop",
        },
      ],
      hypothesis:
        "Crushes and slips cluster on specific products. Skills that packed those products clean are already in Atlas, but the coder never sees them.",
      patch: {
        op: "set_retrieval",
        path: "retrieval.skills_k",
        before: "0",
        after: "3",
        rationale:
          "9 proven per-product skills are stored but unused. Retrieving them adds no tool time, so it avoids over-budget risk.",
        predicted_effect: "Fewer crush and slip failures on repeat products. Cycle time about unchanged.",
      },
      gate: {
        T: [29.2, 77.1],
        H: [75.0, 83.3],
        p_better: 1.0,
        guardrails: [
          { name: "Held-out not down", ok: true, detail: "75.0 → 83.3" },
          { name: "No family regresses > 1 item", ok: true, detail: "collision +0.9, crush −5.5" },
          { name: "Cycle time ≤ +20%", ok: true, detail: "13.1 s → 12.0 s" },
          { name: "Cost ≤ 2×", ok: true, detail: "1.06×" },
        ],
      },
      verdict: { status: "kept", reason: "Train +47.9 pts with P(better) = 1.00, held-out +5.6 pts" },
      cost_usd: 0.0081,
    },
    {
      from: 1,
      to: 2,
      model: "Sonnet 5.5",
      sample: true,
      signals: {
        source: "raindrop",
        failures: [
          { family: "crush", label: "Crushed", count: 5.0 },
          { family: "collision", label: "Collision", count: 2.0 },
          { family: "slip", label: "Slipped", count: 1.5 },
        ],
        memory: { skills: 14, lessons: 6 },
      },
      investigate: [
        {
          tool: "compare_versions",
          args: "Crushed, v0 vs v1",
          result: "21 → 10 items",
          source: "raindrop",
        },
        {
          tool: "find_events",
          args: "Crushed, v1, limit 3",
          result: "cupcakes ×2, cereal: no skill matched, coder guessed fast",
          source: "raindrop",
        },
        {
          tool: "list_gaps",
          args: "v1",
          result: "\"No proven grip for Little Debbie cupcakes\" ×3",
          source: "raindrop",
        },
        {
          tool: "query_atlas",
          args: "memory {kind: lesson}",
          result: "6 critic lessons stored, 0 retrieved (lessons_k = 0)",
          source: "atlas",
        },
      ],
      hypothesis:
        "What's left are products with no skill yet. The critic already wrote class-level lessons (\"thin cartons crush when fast\") that would cover them, but lessons aren't retrieved.",
      patch: {
        op: "set_retrieval",
        path: "retrieval.lessons_k",
        before: "0",
        after: "2",
        rationale:
          "6 critic lessons are stored but retrieved at k = 0. The remaining failures are product-class mistakes the lessons describe.",
        predicted_effect: "Fewer crush, slip and collision failures. T and H up a few points, cost up slightly.",
      },
      gate: {
        T: [77.1, 95.8],
        H: [83.3, 88.9],
        p_better: 0.996,
        guardrails: [
          { name: "Held-out not down", ok: true, detail: "83.3 → 88.9" },
          { name: "No family regresses > 1 item", ok: true, detail: "crush −3.0, collision −1.0" },
          { name: "Cycle time ≤ +20%", ok: true, detail: "12.0 s → 14.3 s (+18.8%)" },
          { name: "Cost ≤ 2×", ok: true, detail: "1.27×" },
        ],
      },
      verdict: { status: "kept", reason: "Train +18.8 pts with P(better) = 1.00, held-out +5.6 pts" },
      cost_usd: 0.0089,
    },
  ],
};

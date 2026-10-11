import type { AppState, Family, FeedType, HarnessVersion } from "./types";

// ---------- verdict colors ----------

export const FAMILY_COLOR: Record<Family | "ok", string> = {
  ok: "#00ED64",
  crush: "#FF5D5D",
  slip: "#B98BFF",
  tip: "#FF9D3C",
  collision: "#FFD53D",
  in_box: "#9AA9B2",
  over_budget: "#5DA8FF",
};

export const FAMILY_WORD: Record<Family | "ok", string> = {
  ok: "packed",
  crush: "crushed",
  slip: "slipped",
  tip: "tipped",
  collision: "collided",
  in_box: "missed box",
  over_budget: "too slow",
};

const SHORT_NAMES: Record<string, string> = {
  cupcakes: "Cupcakes",
  veggie_crackers: "Veggie crackers",
  nesquik: "Nesquik",
  fondant: "Fondant",
  nips_peanut: "Nips peanut",
  girl_scouts_pb: "Girl Scouts PB",
  cereal: "Cereal",
  donut_sticks: "Donut sticks",
  nips_rum: "Nips butter rum",
  girl_scouts_caramel: "Girl Scouts caramel",
  jarrosil: "JarroSil",
  momento: "Momento mocha",
  skinny_cow: "Skinny Cow",
  fruit_snacks: "Fruit snacks",
};

export function shortName(productId: string | null | undefined, label?: string | null): string {
  if (productId && SHORT_NAMES[productId]) return SHORT_NAMES[productId];
  const l = (label || productId || "").trim();
  if (!l) return "item";
  const words = l.split(/\s+/);
  return words.length > 3 ? words.slice(-2).join(" ") : l;
}

// ---------- pipeline stage ----------

export type Stage = "coder" | "sim" | "referee" | "raindrop" | "meta" | "gate";

export const STAGES: { id: Stage; name: string; hint: string }[] = [
  { id: "coder", name: "Coder", hint: "writes the program" },
  { id: "sim", name: "Sim", hint: "MuJoCo physics" },
  { id: "referee", name: "Referee", hint: "hidden physics" },
  { id: "raindrop", name: "Raindrop", hint: "failure signals" },
  { id: "meta", name: "Meta-agent", hint: "one typed patch" },
  { id: "gate", name: "Gate", hint: "held-out A/B" },
];

const FEED_STAGE: Partial<Record<FeedType, Stage>> = {
  signal: "raindrop",
  gap: "coder",
  patch: "meta",
  verdict: "gate",
  tripwire: "gate",
  lesson: "referee",
  skill: "referee",
  recovery: "sim",
};

const FLASH_MS = 4_000;
const IDLE_AFTER_MS = 90_000;

/**
 * Which pipeline stage is working right now. A feed event from the last few seconds flashes its stage;
 * otherwise a leased queue step (work in progress) wins; otherwise the latest feed event, until idle.
 */
export function activeStage(state: AppState): Stage | null {
  const now = Date.parse(state.now);
  const lastFeed = state.feed.find((f) => FEED_STAGE[f.type]);
  const feedAge = lastFeed ? now - Date.parse(lastFeed.ts) : Infinity;
  if (lastFeed && feedAge < FLASH_MS) return FEED_STAGE[lastFeed.type]!;

  let lease: { kind: string; t: number } | null = null;
  for (const o of state.queue?.orders ?? []) {
    for (const s of o.steps) {
      if (s.status !== "leased") continue;
      const t = s.updated_at ? Date.parse(s.updated_at) : 0;
      if (!lease || t > lease.t) lease = { kind: s.kind, t };
    }
  }
  if (lease) return lease.kind === "plan" ? "coder" : lease.kind === "verify" ? "referee" : "sim";

  if (lastFeed && feedAge < IDLE_AFTER_MS) return FEED_STAGE[lastFeed.type]!;
  return null;
}

// ---------- versions ----------

export function incumbent(versions: HarnessVersion[]): HarnessVersion | null {
  const kept = versions.filter((v) => v.status === "kept");
  if (kept.length) return kept.reduce((a, b) => (b.version > a.version ? b : a));
  return versions.find((v) => v.status === "baseline" || v.version === 0) ?? versions[0] ?? null;
}

export function baselineVersion(versions: HarnessVersion[]): HarnessVersion | null {
  return versions.find((v) => v.version === 0) ?? versions.find((v) => v.status === "baseline") ?? null;
}

// ---------- formatting ----------

export function ago(ts: string | null | undefined, nowIso: string): string {
  if (!ts) return "";
  const s = Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(ts)) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

export const pct = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? "–" : `${v.toFixed(digits)}%`;

export const usd = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "–" : v < 0.1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`;

export const secs = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "–" : `${v.toFixed(v < 10 ? 1 : 0)}s`;

export const signed = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? "" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`;

export function modelName(m: string | null | undefined): string {
  if (!m) return "";
  return m.split("/").pop() ?? m;
}

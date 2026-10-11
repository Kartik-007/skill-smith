import "server-only";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Db, Document } from "mongodb";
import { getDb } from "@/lib/mongo";
import type { Row, Store, StorageSnapshot } from "./types";

// Read-only tour of what the system stores. Atlas is read live; the hidden-truth database is never opened (it's
// listed, locked). Raindrop is shown as what we send, rebuilt from our own Atlas records of each run and version.
// Every successful live read refreshes public/storage_snapshot.json, the fallback if Atlas is unreachable on stage.

/** the recorded run the deep dive plays */
const DB_NAME = process.env.STORAGE_DB || "skillsmith";
const SNAPSHOT = path.join(process.cwd(), "public", "storage_snapshot.json");
const SAMPLE = 40;

// ---------- helpers ----------

function fmtDate(v: unknown): string {
  const d = v instanceof Date ? v : typeof v === "string" ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toISOString().replace("T", " ").slice(0, 19);
}

/** shorten what a person can't read anyway: embeddings, physics state vectors, long text */
function compact(v: unknown, depth = 0): unknown {
  if (v instanceof Date) return fmtDate(v);
  if (Array.isArray(v)) {
    if (v.length > 8 && v.every((x) => typeof x === "number")) return `[${v.length} numbers]`;
    return v.slice(0, 12).map((x) => compact(x, depth + 1));
  }
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.toHexString === "function") return (o.toHexString as () => string)();
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, depth > 6 ? "…" : compact(x, depth + 1)]));
  }
  if (typeof v === "string" && v.length > 900) return v.slice(0, 900) + "…";
  return v;
}

const id = (d: Document) => String(d._id);
const pct = (x: unknown) => (typeof x === "number" ? `${x.toFixed(1)}%` : "");
const short = (s: unknown, n = 140) => {
  const t = String(s ?? "");
  return t.length > n ? t.slice(0, n) + "…" : t;
};

const FAMILY_SIGNAL: Record<string, string> = {
  crush: "Crushed",
  slip: "Slipped",
  tip: "Tipped",
  collision: "Collision",
  over_budget: "Over budget",
  in_box: "Not in box",
};

function signalsOf(run: Document): string[] {
  const items = (run.items ?? []) as Document[];
  const s = items.map((it) => (it.ok ? "Packed clean" : FAMILY_SIGNAL[it.family] ?? it.family));
  for (let k = 0; k < ((run.gaps ?? []) as unknown[]).length; k++) s.push("Capability gap");
  return s;
}

function tally(xs: string[]): { label: string; value: string }[] {
  const m = new Map<string, number>();
  xs.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, value: String(n) }));
}

/** the deep dive's story runs first, then the most recent */
async function storyFirst(db: Db, coll: string, storyFilter: Document, rest: Document, sort: Document) {
  const story = await db.collection(coll).find(storyFilter).sort(sort).limit(SAMPLE).toArray();
  const others = await db
    .collection(coll)
    .find({ ...rest, _id: { $nin: story.map((d) => d._id) } })
    .sort(sort)
    .limit(Math.max(0, SAMPLE - story.length))
    .toArray();
  return [...story, ...others];
}

// ---------- stores ----------

async function memoryStore(db: Db, kind: "lesson" | "skill"): Promise<Store> {
  const coll = db.collection("memory");
  const docs = await coll.find({ kind }).sort({ version_created: 1, created_at: 1 }).limit(SAMPLE).toArray();
  const count = await coll.countDocuments({ kind });
  const rows: Row[] = docs.map((d) => ({
    id: id(d),
    cells: (kind === "lesson"
        ? {
            text: String(d.text ?? ""),
            family: FAMILY_SIGNAL[d.family] ?? d.family ?? "",
            class: String(d.class ?? "").replace(/_/g, " "),
            version: d.version_created != null ? `v${d.version_created}` : "",
          }
        : {
            product: String(d.product_id ?? ""),
            grip: d.grip_N != null ? `${d.grip_N} N` : String(d.grip ?? ""),
            speed: d.speed_mps != null ? `${d.speed_mps} m/s` : String(d.speed ?? ""),
            uses: String(d.uses ?? 0),
            version: d.version_created != null ? `v${d.version_created}` : "",
          }) as Record<string, string>,
    raw: compact(d),
  }));
  return kind === "lesson"
    ? {
        id: "lessons",
        group: "atlas",
        label: "Lessons",
        location: "memory  {kind: \"lesson\"}",
        count,
        what: "Rules of thumb the critic writes after failures, so the next program avoids the same mistake.",
        writes: "Critic (Sonnet 5.5), after each evaluation",
        reads: "Coder, through Vector Search",
        feature: "Vector Search: 1024-d Voyage embeddings, one index pre-filtered by kind",
        facets: tally(docs.map((d) => FAMILY_SIGNAL[d.family] ?? String(d.family ?? "general"))),
        columns: [
          { key: "text", label: "Lesson", wide: true },
          { key: "family", label: "Failure" },
          { key: "class", label: "Product class" },
          { key: "version", label: "Written at", mono: true },
        ],
        rows,
      }
    : {
        id: "skills",
        group: "atlas",
        label: "Skills",
        location: "memory  {kind: \"skill\"}",
        count,
        what: "The grip and speed that packed a product clean. Saved automatically after every clean pack.",
        writes: "Verify step, from clean packs",
        reads: "Coder, through Vector Search",
        feature: "Same Vector Search index as lessons, filtered to kind = skill",
        facets: [
          { label: "products covered", value: String(new Set(docs.map((d) => d.product_id)).size) },
          { label: "times retrieved", value: String(docs.reduce((a, d) => a + (Number(d.uses) || 0), 0)) },
        ],
        columns: [
          { key: "product", label: "Product", mono: true, wide: true },
          { key: "grip", label: "Grip", mono: true },
          { key: "speed", label: "Speed", mono: true },
          { key: "uses", label: "Retrieved", mono: true },
          { key: "version", label: "Learned at", mono: true },
        ],
        rows,
      };
}

async function versionsStore(db: Db): Promise<Store> {
  const docs = await db.collection("harness_versions").find({}).sort({ version: 1 }).toArray();
  const verdicts = docs.map((d) => String(d.verdict ?? d.status ?? ""));
  return {
    id: "versions",
    group: "atlas",
    label: "Harness versions",
    location: "harness_versions",
    count: docs.length,
    what: "Every harness config the meta-agent proposed, the one change it made, and the gate's verdict.",
    writes: "Meta-agent (proposal) and gate (scores, verdict)",
    reads: "Workers (the live harness) and the meta-agent (history)",
    feature: "Unique index on version; status field makes a generation resumable",
    facets: tally(verdicts),
    columns: [
      { key: "version", label: "Version", mono: true },
      { key: "patch", label: "Change", mono: true, wide: true },
      { key: "verdict", label: "Verdict" },
      { key: "T", label: "Train", mono: true },
      { key: "H", label: "Held-out", mono: true },
    ],
    rows: docs.map((d) => ({
      id: id(d),
      cells: {
        version: `v${d.version}`,
        patch: String(d.patch_text ?? ""),
        verdict: String(d.verdict ?? d.status ?? "").replace("_", " "),
        T: pct(d.scores?.T),
        H: pct(d.scores?.H),
      },
      tone: d.verdict === "kept" ? "ok" : d.verdict === "rolled_back" || d.verdict === "rejected" ? "bad" : null,
      raw: compact(d),
    })),
  };
}

async function runsStore(db: Db, runs: Document[]): Promise<Store> {
  const count = await db.collection("runs").estimatedDocumentCount();
  const bySuite = await db
    .collection("runs")
    .aggregate([{ $group: { _id: "$suite", n: { $sum: 1 } } }, { $sort: { n: -1 } }])
    .toArray();
  return {
    id: "runs",
    group: "atlas",
    label: "Runs",
    location: "runs",
    count,
    what: "One document per order packed: the program the coder wrote, its actions, and the referee's verdict per item.",
    writes: "Workers, one transaction per queue step",
    reads: "Gate, critic and meta-agent (aggregations by version and failure)",
    feature: "Multi-document transactions; aggregation pipelines for failure rates",
    facets: bySuite.map((b) => ({ label: `suite ${b._id}`, value: String(b.n) })),
    columns: [
      { key: "id", label: "Run", mono: true, wide: true },
      { key: "version", label: "Version", mono: true },
      { key: "order", label: "Order", mono: true },
      { key: "result", label: "Damage-free", mono: true },
      { key: "failures", label: "Failures" },
    ],
    sampled: true,
    rows: runs.map((d) => {
      const items = (d.items ?? []) as Document[];
      const ok = items.filter((it) => it.ok).length;
      return {
        id: id(d),
        cells: {
          id: id(d),
          version: `v${d.version}`,
          order: String(d.order_id ?? ""),
          result: `${ok}/${items.length}`,
          failures:
            items
              .filter((it) => !it.ok)
              .map((it) => FAMILY_SIGNAL[it.family] ?? it.family)
              .join(", ") || "none",
        },
        tone: items.length && ok === items.length ? "ok" : ok === 0 ? "bad" : null,
        raw: compact(d),
      };
    }),
  };
}

async function checkpointsStore(db: Db): Promise<Store> {
  const coll = db.collection("checkpoints");
  const docs = await storyFirst(db, "checkpoints", { order_run_id: /STORY/ }, {}, { created_at: -1 });
  const count = await coll.estimatedDocumentCount();
  let sizeMB = "";
  try {
    const stats = await db.command({ collStats: "checkpoints" });
    sizeMB = `${(Number(stats.size) / 1e6).toFixed(1)} MB`;
  } catch {
    // collStats isn't allowed for every role; the size is a nice-to-have
  }
  const recovered = await coll.countDocuments({ attempt: { $gt: 1 } });
  return {
    id: "checkpoints",
    group: "atlas",
    label: "Checkpoints",
    location: "checkpoints",
    count,
    what: "The exact physics state after every step (mj_getState), so a killed worker resumes from the same instant.",
    writes: "Workers, in the same transaction as the step's result",
    reads: "The next step, or a new worker after a crash",
    feature: "Committed only if the worker still holds the lease token",
    facets: [
      ...(sizeMB ? [{ label: "stored", value: sizeMB }] : []),
      { label: "written on a retry", value: String(recovered) },
    ],
    columns: [
      { key: "id", label: "Checkpoint", mono: true, wide: true },
      { key: "step", label: "After step", mono: true },
      { key: "sim", label: "Sim time", mono: true },
      { key: "state", label: "State", mono: true },
      { key: "attempt", label: "Attempt", mono: true },
    ],
    sampled: true,
    rows: docs.map((d) => ({
      id: id(d),
      cells: {
        id: id(d),
        step: String(d.step_idx ?? ""),
        sim: d.sim_time != null ? `${Number(d.sim_time).toFixed(2)} s` : "",
        state: Array.isArray(d.snapshot?.state) ? `${d.snapshot.state.length} numbers` : "",
        attempt: String(d.attempt ?? 1),
      },
      tone: Number(d.attempt) > 1 ? "ok" : null,
      raw: compact(d),
    })),
  };
}

async function queueStore(db: Db): Promise<Store> {
  const coll = db.collection("work_queue");
  const docs = await storyFirst(db, "work_queue", { order_id: "STORY" }, {}, { updated_at: -1 });
  const count = await coll.estimatedDocumentCount();
  const byStatus = await coll.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray();
  const retried = await coll.countDocuments({ attempts: { $gt: 1 } });
  return {
    id: "queue",
    group: "atlas",
    label: "Work queue",
    location: "work_queue",
    count,
    what: "The night shift as durable jobs: plan, place each item, verify. Workers claim a job with a lease and heartbeat while they work.",
    writes: "Evolve (enqueue) and workers (claim, heartbeat, commit)",
    reads: "Workers",
    feature: "Atomic claim with findOneAndUpdate; lease expiry hands a dead worker's job to another",
    facets: [
      ...byStatus.map((b) => ({ label: String(b._id), value: String(b.n) })),
      { label: "retried after a crash", value: String(retried) },
    ],
    columns: [
      { key: "id", label: "Job", mono: true, wide: true },
      { key: "kind", label: "Step" },
      { key: "status", label: "Status" },
      { key: "attempts", label: "Attempts", mono: true },
    ],
    sampled: true,
    rows: docs.map((d) => ({
      id: id(d),
      cells: {
        id: id(d),
        kind: String(d.kind ?? ""),
        status: String(d.status ?? ""),
        attempts: String(d.attempts ?? 0),
      },
      tone: d.status === "failed" ? "bad" : Number(d.attempts) > 1 ? "ok" : null,
      raw: compact(d),
    })),
  };
}

async function ledgerStore(db: Db): Promise<Store> {
  const coll = db.collection("llm_ledger");
  const docs = await coll.find({}).sort({ created_at: -1 }).limit(SAMPLE).toArray();
  const count = await coll.estimatedDocumentCount();
  const totals = await coll
    .aggregate([{ $group: { _id: "$model", n: { $sum: 1 }, usd: { $sum: "$cost_usd" } } }, { $sort: { n: -1 } }])
    .toArray();
  const usd = totals.reduce((a, t) => a + (Number(t.usd) || 0), 0);
  return {
    id: "ledger",
    group: "atlas",
    label: "LLM ledger",
    location: "llm_ledger",
    count,
    what: "Every model call, keyed by a hash of its prompt. A step replayed after a crash reuses the answer instead of paying again.",
    writes: "Coder, critic and meta-agent calls",
    reads: "The same calls (a replay hits the cache)",
    feature: "Unique index on call_key: no double spend",
    facets: [
      { label: "total spend", value: `$${usd.toFixed(2)}` },
      ...totals.map((t) => ({ label: String(t._id).split("/").pop() ?? "", value: `${t.n} calls` })),
    ],
    columns: [
      { key: "model", label: "Model", mono: true },
      { key: "tokens", label: "Tokens in / out", mono: true },
      { key: "cost", label: "Cost", mono: true },
      { key: "preview", label: "Answer", wide: true },
    ],
    sampled: true,
    rows: docs.map((d) => ({
      id: id(d),
      cells: {
        model: String(d.model ?? "").split("/").pop() ?? "",
        tokens: `${d.response?.tokens_in ?? "?"} / ${d.response?.tokens_out ?? "?"}`,
        cost: d.cost_usd != null ? `$${Number(d.cost_usd).toFixed(4)}` : "",
        preview: short(d.response?.text, 110),
      },
      raw: compact(d),
    })),
  };
}

async function feedStore(db: Db): Promise<Store> {
  const coll = db.collection("feed");
  const docs = await coll.find({}).sort({ ts: 1 }).limit(80).toArray();
  return {
    id: "feed",
    group: "atlas",
    label: "Feed",
    location: "feed",
    count: await coll.estimatedDocumentCount(),
    what: "A readable log of the night: patches, verdicts, lessons, recoveries and tripwires.",
    writes: "Every part of the core",
    reads: "This screen",
    facets: tally(docs.map((d) => String(d.type))),
    columns: [
      { key: "ts", label: "Time", mono: true },
      { key: "type", label: "Type" },
      { key: "text", label: "What happened", wide: true },
    ],
    rows: docs.map((d) => ({
      id: id(d),
      cells: { ts: fmtDate(d.ts).slice(11), type: String(d.type), text: String(d.text ?? "") },
      tone: d.type === "tripwire" ? "bad" : d.type === "verdict" && /kept/i.test(String(d.text)) ? "ok" : null,
      raw: compact(d),
    })),
  };
}

async function catalogStore(db: Db): Promise<Store> {
  const docs = await db.collection("products").find({}).sort({ split: 1, _id: 1 }).toArray();
  const orders = await db.collection("orders").estimatedDocumentCount();
  return {
    id: "products",
    group: "atlas",
    label: "Products and orders",
    location: "products, orders",
    count: docs.length,
    what: `The 14 scanned snacks with what anyone can see (name, size, packaging), plus ${orders} fixed orders. Mass and crush limits are not here.`,
    writes: "Seed",
    reads: "Coder (descriptions), memory (product vectors)",
    feature: "Product embeddings cached here, so retrieval costs no extra Voyage calls",
    facets: tally(docs.map((d) => `${d.split} split`)),
    columns: [
      { key: "label", label: "Product", wide: true },
      { key: "class", label: "Class" },
      { key: "split", label: "Split" },
      { key: "size", label: "Size (mm)", mono: true },
    ],
    rows: docs.map((d) => ({
      id: id(d),
      cells: {
        label: String(d.label ?? ""),
        class: String(d.class ?? "").replace(/_/g, " "),
        split: String(d.split ?? ""),
        size: Array.isArray(d.size_mm) ? d.size_mm.join(" × ") : "",
      },
      raw: compact(d),
    })),
  };
}

function truthStore(): Store {
  return {
    id: "truth",
    group: "truth",
    label: "Hidden truth",
    location: "skillsmith_truth.scene_truth",
    count: null,
    what: "The real mass, friction, crush limit and condition of every item in every order. This is what decides whether a pick crushes or slips.",
    writes: "Seed",
    reads: "Referee only",
    feature: "A separate database. The agents' Atlas login is refused on it (code 13), and this screen never opens it.",
    facets: [],
    columns: [],
    rows: [],
    locked: true,
  };
}

// ---------- Raindrop: what we send, rebuilt from Atlas ----------

function eventsStore(runs: Document[], total: number): Store {
  const withEvent = runs.filter((d) => d.raindrop_event_id);
  return {
    id: "rd-events",
    group: "raindrop",
    label: "pack_order events",
    location: "Raindrop  event: pack_order",
    count: total,
    what: "One event per order packed: the order and harness as input, the coder's program as output, and the scores as properties.",
    writes: "Verify step",
    reads: "Meta-agent, through the Query API (counts per version)",
    feature: "Event ids are deterministic, so a replayed step re-sends the same event",
    facets: [{ label: "properties", value: "harness_version, suite, order_id, damage_free, cycle_s, cost_usd" }],
    columns: [
      { key: "event", label: "Event id", mono: true },
      { key: "run", label: "Run", mono: true, wide: true },
      { key: "version", label: "harness_version", mono: true },
      { key: "damage", label: "damage_free", mono: true },
    ],
    sampled: true,
    rows: (withEvent.length ? withEvent : runs).map((d) => {
      const items = (d.items ?? []) as Document[];
      return {
        id: id(d),
        cells: {
          event: d.raindrop_event_id ? String(d.raindrop_event_id).slice(0, 8) + "…" : "not sent",
          run: id(d),
          version: String(d.version),
          damage: `${items.filter((it) => it.ok).length}/${items.length}`,
        },
        raw: {
          event: "pack_order",
          event_id: d.raindrop_event_id ?? null,
          user_id: String(d.customer ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          model: d.model,
          input: `Order ${d.order_id}: ${items.map((it) => `${it.id} ${it.label}`).join("; ")}`,
          output: short(d.plan_code, 600),
          properties: {
            harness_version: d.version,
            suite: d.suite,
            order_id: d.order_id,
            damage_free: d.damage_free,
            n_items: d.n_items,
            cycle_s: d.cycle_s,
            cost_usd: d.cost_usd,
          },
          signals: signalsOf(d),
        },
      };
    }),
  };
}

async function signalsStore(db: Db): Promise<Store> {
  const fams = await db
    .collection("runs")
    .aggregate([
      { $unwind: "$items" },
      { $group: { _id: { v: "$version", f: { $ifNull: ["$items.family", "ok"] } }, n: { $sum: 1 } } },
      { $sort: { "_id.v": 1, n: -1 } },
    ])
    .toArray();
  const gaps = await db
    .collection("runs")
    .aggregate([{ $unwind: "$gaps" }, { $group: { _id: "$version", n: { $sum: 1 }, eg: { $first: "$gaps" } } }, { $sort: { _id: 1 } }])
    .toArray();
  const rows: Row[] = [
    ...fams.map((r) => {
      const name = r._id.f === "ok" ? "Packed clean" : FAMILY_SIGNAL[r._id.f] ?? r._id.f;
      return {
        id: `v${r._id.v}-${r._id.f}`,
        cells: { version: `v${r._id.v}`, signal: name, kind: r._id.f === "ok" ? "positive" : "negative", n: String(r.n), example: "" },
        tone: (r._id.f === "ok" ? "ok" : "bad") as Row["tone"],
        raw: { signal: name, sentiment: r._id.f === "ok" ? "POSITIVE" : "NEGATIVE", properties: { harness_version: r._id.v }, items: r.n },
      };
    }),
    ...gaps.map((g) => ({
      id: `v${g._id}-gap`,
      cells: { version: `v${g._id}`, signal: "Capability gap", kind: "feedback", n: String(g.n), example: short(g.eg, 90) },
      tone: null,
      raw: { signal: "Capability gap", signal_type: "feedback", properties: { harness_version: g._id }, items: g.n, example_comment: g.eg },
    })),
  ].sort((a, b) => a.cells.version.localeCompare(b.cells.version, undefined, { numeric: true }));
  const total = new Map<string, number>();
  rows.forEach((r) => total.set(r.cells.signal, (total.get(r.cells.signal) ?? 0) + Number(r.cells.n)));
  return {
    id: "rd-signals",
    group: "raindrop",
    label: "Signals",
    location: "Raindrop  signals on pack_order",
    count: [...total.values()].reduce((a, b) => a + b, 0),
    what: "One signal per item the referee graded (Crushed, Slipped, Packed clean…), plus the coder's own capability-gap feedback.",
    writes: "Verify step (referee verdicts), coder (gaps)",
    reads: "Meta-agent: what failed most in this version",
    facets: [...total.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, value: String(n) })),
    columns: [
      { key: "version", label: "Version", mono: true },
      { key: "signal", label: "Signal" },
      { key: "kind", label: "Sentiment" },
      { key: "n", label: "Items", mono: true },
      { key: "example", label: "Example", wide: true },
    ],
    rows,
  };
}

async function patchEventsStore(db: Db): Promise<Store> {
  const docs = await db.collection("harness_versions").find({}).sort({ version: 1 }).toArray();
  return {
    id: "rd-patches",
    group: "raindrop",
    label: "harness_patch events",
    location: "Raindrop  event: harness_patch",
    count: docs.length,
    what: "One event per generation: the meta-agent's change as input, the gate's verdict as output.",
    writes: "Evolve, after the gate rules",
    reads: "Anyone reviewing how the harness evolved",
    facets: tally(docs.map((d) => `gate_${d.verdict ?? d.status}`)),
    columns: [
      { key: "version", label: "harness_version", mono: true },
      { key: "input", label: "Input (change)", mono: true, wide: true },
      { key: "signal", label: "Signal", mono: true },
    ],
    rows: docs.map((d) => ({
      id: id(d),
      cells: { version: String(d.version), input: String(d.patch_text ?? ""), signal: `gate_${d.verdict ?? d.status}` },
      tone: d.verdict === "kept" ? "ok" : d.verdict === "rolled_back" || d.verdict === "rejected" ? "bad" : null,
      raw: {
        event: "harness_patch",
        user_id: "meta-agent",
        model: d.meta?.model ?? null,
        input: `${d.patch_text}\nRationale: ${short(d.rationale, 400)}`,
        output: `${d.verdict}: ${d.verdict_reason ?? ""}`,
        properties: { harness_version: d.version, parent: d.parent ?? 0, verdict: d.verdict, H: d.scores?.H, T: d.scores?.T },
        signal: `gate_${d.verdict}`,
      },
    })),
  };
}

// ---------- entry ----------

async function loadLive(): Promise<StorageSnapshot> {
  const db = await getDb(DB_NAME);
  const runs = await storyFirst(db, "runs", { order_id: "STORY" }, {}, { created_at: -1 });
  const runCount = await db.collection("runs").estimatedDocumentCount();
  const stores = await Promise.all([
    memoryStore(db, "lesson"),
    memoryStore(db, "skill"),
    versionsStore(db),
    runsStore(db, runs),
    checkpointsStore(db),
    queueStore(db),
    ledgerStore(db),
    feedStore(db),
    catalogStore(db),
    Promise.resolve(truthStore()),
    Promise.resolve(eventsStore(runs, runCount)),
    signalsStore(db),
    patchEventsStore(db),
  ]);
  return { source: "live", db: DB_NAME, taken_at: new Date().toISOString(), stores };
}

export async function loadStorage(): Promise<StorageSnapshot> {
  try {
    const live = await loadLive();
    writeFile(SNAPSHOT, JSON.stringify({ ...live, source: "snapshot" })).catch(() => {});
    return live;
  } catch (e) {
    try {
      const snap = JSON.parse(await readFile(SNAPSHOT, "utf8")) as StorageSnapshot;
      return { ...snap, source: "snapshot", error: String(e) };
    } catch {
      return { source: "snapshot", db: DB_NAME, taken_at: "", stores: [truthStore()], error: String(e) };
    }
  }
}

import "server-only";
import type { Db, Document } from "mongodb";
import { getDb, hasDbConfig } from "./mongo";
import { MOCK_PRODUCTS, mockSections, mockState } from "./mock";
import type {
  AppState,
  Family,
  FeedItem,
  FeedType,
  HarnessVersion,
  LiveRequest,
  ProductOption,
  QueueOrder,
  QueueSnapshot,
  Recovery,
  RunSummary,
  Section,
  StepKind,
  StepStatus,
  VersionStatus,
} from "./types";

// ---------- tolerant field readers: the core may add or omit fields ----------

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v == null ? d : String(v));
const strOrNull = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const iso = (v: unknown): string | null => {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && v) return v;
  return null;
};
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const NO_HEAVY = { embedding: 0, state: 0 } as const;
const RUN_PROJECTION = { embedding: 0, state: 0, plan_code: 0, actions: 0, tool_calls: 0, prompt: 0 } as const;

function toVersion(d: Document): HarnessVersion {
  const patch = d.patch && typeof d.patch === "object" ? { op: str(d.patch.op), args: obj(d.patch.args) } : null;
  return {
    version: num(d.version) ?? 0,
    parent: num(d.parent),
    status: str(d.status, "running") as VersionStatus,
    patch,
    patch_text: str(d.patch_text),
    rationale: str(d.rationale),
    predicted_effect: str(d.predicted_effect),
    verdict: strOrNull(d.verdict),
    verdict_reason: str(d.verdict_reason),
    scores: d.scores && typeof d.scores === "object" ? (d.scores as HarnessVersion["scores"]) : null,
    models: d.models && typeof d.models === "object" ? (d.models as HarnessVersion["models"]) : null,
    created_at: iso(d.created_at),
    finished_at: iso(d.finished_at),
  };
}

function toFeed(d: Document): FeedItem {
  return {
    id: str(d._id),
    ts: iso(d.ts) ?? new Date(0).toISOString(),
    type: str(d.type, "info") as FeedType,
    text: str(d.text),
    refs: obj(d.refs),
  };
}

function toRecovery(f: FeedItem): Recovery {
  const r = f.refs;
  return {
    id: f.id,
    ts: f.ts,
    text: f.text,
    order_run_id: strOrNull(r.order_run_id),
    step_idx: num(r.step_idx),
    attempt: num(r.attempt),
    before_frame: strOrNull(r.before_frame),
    after_frame: strOrNull(r.after_frame),
    pixel_diff: num(r.pixel_diff),
  };
}

function toRun(d: Document, frame: string | null = null): RunSummary {
  const items = Array.isArray(d.items) ? d.items : [];
  return {
    id: str(d._id),
    batch_id: strOrNull(d.batch_id),
    version: num(d.version),
    order_id: str(d.order_id),
    suite: strOrNull(d.suite),
    customer: strOrNull(d.customer),
    items: items.map((it: Document) => ({
      id: str(it.id),
      label: str(it.label, str(it.product_id)),
      product_id: str(it.product_id),
      ok: Boolean(it.ok),
      family: (strOrNull(it.family) as Family | null) ?? null,
      detail: str(it.detail),
      tilt_deg: num(it.tilt_deg),
    })),
    damage_free: num(d.damage_free) ?? items.filter((it: Document) => it.ok).length,
    n_items: num(d.n_items) ?? items.length,
    cycle_s: num(d.cycle_s),
    cost_usd: num(d.cost_usd),
    video: strOrNull(d.video),
    frame,
    status: str(d.status, "done"),
    created_at: iso(d.created_at),
  };
}

// ---------- sections ----------

async function loadQueue(db: Db, now: number): Promise<QueueSnapshot | null> {
  const batches = db.collection("batches");
  let batch =
    (await batches.findOne({ status: "running" }, { sort: { created_at: -1 }, projection: NO_HEAVY })) ??
    (await batches.findOne({}, { sort: { created_at: -1 }, projection: NO_HEAVY }));
  const wq = db.collection("work_queue");
  if (!batch) {
    const latest = await wq.findOne({}, { sort: { updated_at: -1 }, projection: { batch_id: 1 } });
    if (!latest) return null; // empty queue -> caller falls back to mock
    batch = { _id: latest.batch_id, status: "running", kind: "eval" };
  }
  const steps = await wq
    .find({ batch_id: batch._id }, { projection: NO_HEAVY })
    .sort({ order_run_id: 1, step_idx: 1 })
    .limit(800)
    .toArray();

  const orders = new Map<string, QueueOrder>();
  const workers = new Set<string>();
  for (const s of steps) {
    const runId = str(s.order_run_id, str(s._id).split(":").slice(0, -1).join(":"));
    let o = orders.get(runId);
    if (!o) {
      o = { order_run_id: runId, order_id: str(s.order_id, runId), version: num(s.version), repeat: num(s.repeat), steps: [] };
      orders.set(runId, o);
    }
    const lease = s.lease && typeof s.lease === "object" ? s.lease : null;
    const status = str(s.status, "pending") as StepStatus;
    const expires = lease ? iso(lease.expires_at) : null;
    const leased = status === "leased";
    if (leased && lease?.owner) workers.add(str(lease.owner));
    o.steps.push({
      id: str(s._id),
      step_idx: num(s.step_idx) ?? o.steps.length,
      kind: str(s.kind, "place") as StepKind,
      label: strOrNull(s.label) ?? strOrNull(s.item_id),
      status,
      attempts: num(s.attempts) ?? 0,
      owner: lease ? strOrNull(lease.owner) : null,
      lease_expires_at: leased ? expires : null,
      lease_remaining_s: leased && expires ? Math.round((Date.parse(expires) - now) / 1000) : null,
      updated_at: iso(s.updated_at),
    });
  }
  const list = [...orders.values()].sort(
    (a, b) => a.order_id.localeCompare(b.order_id) || (a.repeat ?? 0) - (b.repeat ?? 0),
  );
  const all = list.flatMap((o) => o.steps);
  return {
    batch_id: str(batch._id),
    version: num(batch.version),
    kind: str(batch.kind, "eval"),
    generation: num(batch.generation),
    status: str(batch.status, "running"),
    n_steps: num(batch.n_steps) ?? all.length,
    n_done: all.filter((s) => s.status === "done").length,
    n_failed: all.filter((s) => s.status === "failed").length,
    workers: [...workers].sort(),
    orders: list,
  };
}

function incumbentVersion(versions: HarnessVersion[]): number {
  const kept = versions.filter((v) => v.status === "kept").map((v) => v.version);
  return kept.length ? Math.max(...kept) : 0;
}

async function latestFrame(db: Db, runId: string): Promise<string | null> {
  const cp = await db
    .collection("checkpoints")
    .findOne({ order_run_id: runId }, { sort: { step_idx: -1, created_at: -1 }, projection: { frame: 1 } });
  return cp ? strOrNull(cp.frame) : null;
}

async function loadShowcase(db: Db, versions: HarnessVersion[], now: number) {
  const batches = db.collection("batches");
  const runs = db.collection("runs");
  const [showcaseBatches, liveBatches] = await Promise.all([
    batches.find({ kind: "showcase" }, { projection: { _id: 1 } }).sort({ created_at: -1 }).limit(30).toArray(),
    batches.find({ kind: "live" }, { projection: { _id: 1 } }).sort({ created_at: -1 }).limit(10).toArray(),
  ]);
  const hasVideo = { video: { $nin: [null, ""] } };
  let withVideo = showcaseBatches.length
    ? await runs
        .find({ batch_id: { $in: showcaseBatches.map((b) => b._id) }, ...hasVideo }, { projection: RUN_PROJECTION })
        .sort({ created_at: -1 })
        .limit(40)
        .toArray()
    : [];
  if (!withVideo.length) {
    withVideo = await runs
      .find({ ...hasVideo, batch_id: { $nin: liveBatches.map((b) => b._id) }, suite: { $ne: "live" } }, { projection: RUN_PROJECTION })
      .sort({ created_at: -1 })
      .limit(40)
      .toArray();
  }
  const pick = (pred: (d: Document) => boolean) =>
    withVideo.find((d) => pred(d) && d.order_id === "STORY") ?? withVideo.find(pred) ?? null;
  const best = incumbentVersion(versions);
  const baselineDoc = pick((d) => d.version === 0);
  let bestDoc = best > 0 ? pick((d) => d.version === best) : null;
  if (!bestDoc) {
    const others = withVideo.filter((d) => num(d.version) && d.version > 0);
    const top = others.reduce<number>((m, d) => Math.max(m, d.version), 0);
    bestDoc = top ? pick((d) => d.version === top) : null;
  }

  const liveDoc = await runs.findOne(
    { $or: [{ batch_id: { $in: liveBatches.map((b) => b._id) } }, { suite: "live" }] },
    { sort: { created_at: -1 }, projection: RUN_PROJECTION },
  );
  let live: RunSummary | null = null;
  if (liveDoc) {
    const created = iso(liveDoc.created_at);
    const fresh = !created || now - Date.parse(created) < 20 * 60 * 1000;
    if (fresh) live = toRun(liveDoc, liveDoc.video ? null : await latestFrame(db, str(liveDoc._id)));
  }
  return {
    found: Boolean(baselineDoc || bestDoc),
    showcase: { baseline: baselineDoc ? toRun(baselineDoc) : null, best: bestDoc ? toRun(bestDoc) : null, live },
  };
}

async function loadFromDb(db: Db, now: number): Promise<AppState> {
  const [versionsDesc, feedDocs, recoveryDocs, productDocs, liveDocs] = await Promise.all([
    db.collection("harness_versions").find({}, { projection: NO_HEAVY }).sort({ version: -1 }).limit(12).toArray(),
    db.collection("feed").find({}, { projection: NO_HEAVY }).sort({ ts: -1 }).limit(40).toArray(),
    db.collection("feed").find({ type: "recovery" }, { projection: NO_HEAVY }).sort({ ts: -1 }).limit(5).toArray(),
    db
      .collection("products")
      .find({ split: "train" }, { projection: { _id: 1, label: 1 } })
      .sort({ label: 1 })
      .toArray(),
    db.collection("live_requests").find({}).sort({ created_at: -1 }).limit(6).toArray(),
  ]);

  const mock = mockSections(now);
  const mocked: Section[] = [];

  let versions = versionsDesc.map(toVersion).reverse();
  if (!versions.length) {
    versions = mock.versions;
    mocked.push("versions");
  }
  let feed = feedDocs.map(toFeed);
  if (!feed.length) {
    feed = mock.feed;
    mocked.push("feed");
  }
  let recoveries = recoveryDocs.map((d) => toRecovery(toFeed(d)));
  if (!recoveries.length) {
    recoveries = mock.recoveries;
    mocked.push("recoveries");
  }
  let products: ProductOption[] = productDocs.map((d) => ({ id: str(d._id), label: str(d.label, str(d._id)) }));
  if (!products.length) {
    products = MOCK_PRODUCTS;
    mocked.push("products");
  }

  const [queueReal, show] = await Promise.all([loadQueue(db, now), loadShowcase(db, versions, now)]);
  let queue = queueReal;
  if (!queue) {
    queue = mock.queue;
    mocked.push("queue");
  }
  let showcase = show.showcase;
  if (!show.found) {
    showcase = { ...mock.showcase, live: show.showcase.live };
    mocked.push("showcase");
  }

  const live_requests: LiveRequest[] = liveDocs.map((d) => ({
    id: str(d._id),
    name: str(d.name),
    product_id: str(d.product_id),
    status: str(d.status, "new"),
    created_at: iso(d.created_at),
  }));

  return {
    now: new Date(now).toISOString(),
    source: "db",
    mocked,
    db_error: null,
    versions,
    feed,
    queue,
    showcase,
    recoveries,
    products,
    live_requests,
  };
}

export async function loadState(opts: { forceMock?: boolean } = {}): Promise<AppState> {
  const now = Date.now();
  if (opts.forceMock) return mockState(now);
  if (!hasDbConfig()) return { ...mockState(now), db_error: "MONGODB_URI not set" };
  try {
    const db = await getDb();
    return await loadFromDb(db, now);
  } catch (err) {
    // Keep the screen alive; never send connection details to the browser.
    console.error("[api/state] Atlas read failed:", (err as Error)?.name, (err as Error)?.message?.slice(0, 200));
    return { ...mockState(now), db_error: "Atlas unreachable, showing sample data" };
  }
}

"""Generations: evaluate -> critic -> meta-agent -> validate -> evaluate candidate -> gate.

Durable: each generation's state lives in `harness_versions` (status evaluating / kept / rolled_back / rejected),
and its evaluation is a queue batch. Restarting `evolve` resumes at the first unfinished generation.
"""
import json
import multiprocessing as mp
import time

from pymongo.errors import OperationFailure

from . import db as dbm
from . import gate, genome, memory
from . import queue as q
from .agents import critic, meta
from .config import CODER_MODEL, STRONG_MODEL

REPEATS = 2


def _models(g: dict) -> dict:
    tier = {"cheap": CODER_MODEL, "strong": STRONG_MODEL}
    return {role: tier[t] for role, t in g["models"].items()}


def _batch_runs(version: int, control_version: int | None) -> list[dict]:
    orders = list(dbm.db().orders.find({"suite": {"$in": ["T", "H"]}}, {"_id": 1, "suite": 1}))
    runs = [{"order_id": o["_id"], "suite": o["suite"], "repeat": r, "version": version}
            for o in orders for r in range(REPEATS)]
    if control_version is not None:
        runs += [{"order_id": o["_id"], "suite": o["suite"], "repeat": 0, "version": control_version}
                 for o in orders if o["suite"] == "H"]
    return runs


def _worker_proc(batch_ids):
    from . import worker
    worker.loop(batch_ids, exit_when_idle=False, verbose=False)


def wait_batch(batch_id: str, workers: int) -> None:
    procs = [mp.Process(target=_worker_proc, args=([batch_id],), daemon=True) for _ in range(workers)]
    for p in procs:
        p.start()
    try:
        last = None
        while True:
            left = q.batch_remaining(batch_id)
            if left != last:
                print(f"  batch {batch_id}: {left} steps left", flush=True)
                last = left
            if left == 0:
                break
            time.sleep(2)
    finally:
        for p in procs:
            p.terminate()
        for p in procs:
            p.join(timeout=5)
    dbm.db().batches.update_one({"_id": batch_id}, {"$set": {"status": "done", "finished_at": dbm.now()}})
    n = memory.embed_pending()
    if n:
        dbm.feed("skill", f"{n} new skills from clean packs saved to Atlas Vector Search")


def _runs(version: int, suite: str, batch_ids: list[str] | None = None) -> list[dict]:
    filt = {"version": version, "suite": suite, "status": "done"}
    if batch_ids:
        filt["batch_id"] = {"$in": batch_ids}
    return list(dbm.db().runs.find(filt, {"plan_code": 0}))


def family_rates(version: int) -> list[dict]:
    """Atlas aggregation: failures per family and product class on the training suite."""
    pipeline = [
        {"$match": {"version": version, "suite": "T", "status": "done"}},
        {"$unwind": "$items"},
        {"$lookup": {"from": "products", "localField": "items.product_id", "foreignField": "_id", "as": "p"}},
        {"$unwind": "$p"},
        {"$group": {"_id": {"family": {"$ifNull": ["$items.family", "ok"]}, "class": "$p.class"},
                    "n": {"$sum": 1}, "products": {"$addToSet": "$p.label"}}},
        {"$sort": {"n": -1}},
    ]
    return [{"family": r["_id"]["family"], "class": r["_id"]["class"], "n": r["n"], "products": r["products"][:4]}
            for r in dbm.db().runs.aggregate(pipeline)]


def run_critic(version: int, batch_id: str) -> None:
    runs = _runs(version, "T", [batch_id])
    failures = []
    for r in runs:
        acts = {a["item"]: a for a in r["actions"]}
        tools = {}
        for t in r.get("tool_calls", []):
            tools.setdefault(t["item"], []).append(f"{t['tool']}={t['answer']}")
        for it in r["items"]:
            if not it["ok"]:
                a = acts.get(it["id"], {})
                prod = dbm.db().products.find_one({"_id": it["product_id"]}, {"label": 1, "class": 1, "description": 1})
                failures.append({"product": prod["label"], "packaging": prod["description"], "class": prod["class"],
                                 "family": it["family"], "detail": it["detail"], "grip": a.get("grip"),
                                 "speed": a.get("speed"), "tools": tools.get(it["id"], [])})
    if not failures:
        return
    known = [m["text"] for m in dbm.db().memory.find({"kind": "lesson", "active": True}, {"text": 1})]
    out = critic.write_lessons(failures, known)
    memory.add_many("lesson", [{"text": l["text"], "class": l.get("product_class"), "family": l.get("family"),
                                "version_created": version, "source_batch": batch_id} for l in out["lessons"]])
    for l in out["lessons"]:
        dbm.feed("lesson", f"Critic: {l['text']}", version=version)


def _signals(version: int) -> dict:
    """What the meta-agent sees from Raindrop. Without a query key this is read from the same facts in Atlas."""
    pipeline = [
        {"$match": {"version": version, "suite": "T", "status": "done"}},
        {"$unwind": "$items"},
        {"$group": {"_id": {"$ifNull": ["$items.family", "packed_clean"]}, "n": {"$sum": 1}}},
    ]
    names = {"crush": "crushed", "slip": "slipped", "tip": "tipped", "in_box": "not_in_box"}
    counts = {names.get(r["_id"], r["_id"]): r["n"] for r in dbm.db().runs.aggregate(pipeline)}
    gaps = dbm.db().runs.distinct("gaps", {"version": version, "suite": "T"})
    return {"source": "atlas (mirror of the Raindrop signals)", "signal_counts": counts, "capability_gaps": gaps[:8]}


def _history() -> list[dict]:
    return [{"version": v["version"], "patch": v.get("patch_text"), "verdict": v.get("verdict"),
             "reason": v.get("verdict_reason"), "H": v.get("scores", {}).get("H"), "T": v.get("scores", {}).get("T")}
            for v in dbm.db().harness_versions.find({}, {"genome": 0}).sort("version", 1)]


def _run_query(qry: dict, version: int):
    try:
        res = dbm.agent_query(qry.get("database", ""), qry.get("collection", ""), qry.get("filter") or {})
        return json.loads(json.dumps(res, default=str))[:10]
    except OperationFailure as e:
        dbm.feed("tripwire", f"Meta-agent tried to read {qry.get('database')}.{qry.get('collection')}: "
                 f"Atlas said no (code {e.code})", version=version, query=json.dumps(qry)[:300])
        return {"error": str(e), "code": e.code}


def score_version(version: int, batch_id: str, control_batches: list[str] | None = None) -> dict:
    T = gate.summarize(_runs(version, "T", [batch_id]))
    H = gate.summarize(_runs(version, "H", [batch_id] + (control_batches or [])))
    fam = {f: T["family_per_pass"].get(f, 0) + H["family_per_pass"].get(f, 0) for f in gate.FAMILIES}
    return {"T": T["pct"], "H": H["pct"], "by_family": fam, "cycle_s": T["cycle_s"], "cost_usd": T["cost_usd"]}


def ensure_baseline(workers: int) -> dict:
    d = dbm.db()
    v0 = d.harness_versions.find_one({"version": 0})
    if v0 is None:
        d.harness_versions.insert_one({
            "version": 0, "parent": None, "status": "evaluating", "genome": genome.V0, "patch": None,
            "patch_text": "baseline harness", "rationale": "", "predicted_effect": "", "verdict": None,
            "verdict_reason": "", "scores": {}, "models": _models(genome.V0), "batch_id": "g00",
            "created_at": dbm.now(), "finished_at": None})
        v0 = d.harness_versions.find_one({"version": 0})
    if v0["status"] == "evaluating":
        q.enqueue_batch("g00", 0, _batch_runs(0, None), generation=0)
        dbm.feed("info", "Night shift started: evaluating baseline harness v0", version=0)
        wait_batch("g00", workers)
        scores = score_version(0, "g00")
        d.harness_versions.update_one({"version": 0}, {"$set": {
            "status": "baseline", "verdict": "baseline", "scores": scores, "finished_at": dbm.now()}})
        dbm.feed("verdict", f"Baseline v0: held-out {scores['H']}% damage-free, train {scores['T']}%", version=0)
        run_critic(0, "g00")
        v0 = d.harness_versions.find_one({"version": 0})
    return v0


def incumbent() -> dict:
    return dbm.db().harness_versions.find_one({"status": {"$in": ["baseline", "kept"]}}, sort=[("version", -1)])


def generation(workers: int, forced_patch: dict | None = None) -> dict:
    d = dbm.db()
    inc = incumbent()
    cand = d.harness_versions.find_one({"status": "evaluating"})
    if cand is None:
        version = d.harness_versions.find_one(sort=[("version", -1)])["version"] + 1
        ctx = {
            "incumbent_version": inc["version"], "genome": inc["genome"],
            "scores": inc["scores"], "history": _history(),
            "failures_by_family_and_class_train": family_rates(inc["version"]),
            "raindrop_signals": _signals(inc["version"]),
            "memory": {"lessons": d.memory.count_documents({"kind": "lesson"}),
                       "skills": d.memory.count_documents({"kind": "skill"})},
            "databases": {"skillsmith": sorted(d.list_collection_names()), "skillsmith_truth": ["scene_truth"]},
        }
        if forced_patch:
            prop = {"patch": forced_patch["patch"], "rationale": forced_patch.get("rationale", ""),
                    "predicted_effect": forced_patch.get("predicted_effect", ""), "cost_usd": 0.0, "model": "scripted",
                    "query": None}
        else:
            prop = meta.propose(ctx, lambda qry: _run_query(qry, version))
        patch_text = genome.describe(prop["patch"])
        dbm.feed("patch", f"Meta-agent: {patch_text}. {prop['rationale']}", version=version)
        doc = {"version": version, "parent": inc["version"], "patch": prop["patch"], "patch_text": patch_text,
               "rationale": prop["rationale"], "predicted_effect": prop["predicted_effect"],
               "meta": {"model": prop["model"], "cost_usd": prop["cost_usd"], "query": prop.get("query")},
               "created_at": dbm.now(), "finished_at": None, "scores": {}}
        try:
            g = genome.apply(inc["genome"], prop["patch"])
        except genome.PatchRejected as e:
            d.harness_versions.insert_one({**doc, "genome": inc["genome"], "status": "rejected", "verdict": "rejected",
                                           "verdict_reason": f"validator: {e}", "models": _models(inc["genome"]),
                                           "finished_at": dbm.now()})
            dbm.feed("verdict", f"Gate: v{version} REJECTED before evaluation ({e})", version=version)
            return d.harness_versions.find_one({"version": version})
        batch_id = f"g{version:02d}"
        d.harness_versions.insert_one({**doc, "genome": g, "status": "evaluating", "verdict": None,
                                       "verdict_reason": "", "models": _models(g), "batch_id": batch_id})
        cand = d.harness_versions.find_one({"version": version})
    version, batch_id = cand["version"], cand["batch_id"]
    q.enqueue_batch(batch_id, version, _batch_runs(version, inc["version"]), generation=version)
    wait_batch(batch_id, workers)
    inc_batches = [inc["batch_id"]] + [v["batch_id"] for v in d.harness_versions.find(
        {"parent": inc["version"], "batch_id": {"$exists": True}, "status": {"$ne": "evaluating"}}, {"batch_id": 1})]
    cT = gate.summarize(_runs(version, "T", [batch_id]))
    cH = gate.summarize(_runs(version, "H", [batch_id]))
    iT = gate.summarize(_runs(inc["version"], "T", [inc["batch_id"]]))
    iH = gate.summarize(_runs(inc["version"], "H", inc_batches + [batch_id]))
    dec = gate.decide(cT, iT, cH, iH)
    fam = {f: cT["family_per_pass"].get(f, 0) + cH["family_per_pass"].get(f, 0) for f in gate.FAMILIES}
    scores = {"T": cT["pct"], "H": cH["pct"], "by_family": fam, "cycle_s": cT["cycle_s"], "cost_usd": cT["cost_usd"],
              "p_better": dec["p_better"], "delta_T": dec["delta_T"], "delta_H": dec["delta_H"],
              "incumbent_H_control": iH["pct"]}
    d.harness_versions.update_one({"version": version}, {"$set": {
        "status": dec["verdict"], "verdict": dec["verdict"], "verdict_reason": dec["reason"], "scores": scores,
        "finished_at": dbm.now()}})
    dbm.feed("verdict", f"Gate: v{version} {dec['verdict'].upper().replace('_', ' ')} ({cand['patch_text']}): "
             f"{dec['reason']}", version=version)
    run_critic(version, batch_id)
    return d.harness_versions.find_one({"version": version})


def run(generations: int, workers: int) -> None:
    memory.ensure_index()
    ensure_baseline(workers)
    for _ in range(generations):
        v = generation(workers)
        print(f"v{v['version']}: {v['patch_text']} -> {v['verdict']} ({v.get('verdict_reason', '')}) "
              f"H={v.get('scores', {}).get('H')} T={v.get('scores', {}).get('T')}", flush=True)

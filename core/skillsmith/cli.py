"""skillsmith CLI: seed | worker | evolve | showcase | live | status | oracle"""
import argparse
import multiprocessing as mp
import re
import time

from . import catalog, memory
from . import db as dbm
from . import queue as q
from .config import DB_NAME, TRUTH_DB_NAME


def cmd_seed(args) -> None:
    from .suites import build_suites
    c = dbm.client()
    if args.reset:
        c.drop_database(DB_NAME)
        c.drop_database(TRUTH_DB_NAME)
    d = dbm.db()
    d.products.delete_many({})
    d.products.insert_many([{**catalog.visible(p.id), "_id": p.id, "split": p.split, "gso_dir": p.gso,
                             "size_mm": catalog.visible(p.id)["approx_size_mm"]} for p in catalog.PRODUCTS])
    orders, truth = build_suites()
    d.orders.delete_many({})
    d.orders.insert_many(orders)
    t = dbm.truth_db("seed").scene_truth
    t.delete_many({})
    t.insert_many(truth)
    vecs = memory.embed([f"{p.label}: {p.description}" for p in catalog.PRODUCTS])
    for p, v in zip(catalog.PRODUCTS, vecs):
        d.products.update_one({"_id": p.id}, {"$set": {"embedding": v}})
    dbm.ensure_indexes()
    memory.ensure_index()
    print(f"seeded {len(catalog.PRODUCTS)} products, {len(orders)} orders, {len(truth)} hidden truth docs")


def _worker(batch_ids, exit_when_idle):
    from . import worker
    worker.loop(batch_ids, exit_when_idle=exit_when_idle)


def cmd_worker(args) -> None:
    batch_ids = args.batch or None
    if args.n == 1:
        _worker(batch_ids, args.exit_when_idle)
        return
    procs = [mp.Process(target=_worker, args=(batch_ids, args.exit_when_idle)) for _ in range(args.n)]
    for p in procs:
        p.start()
    for p in procs:
        p.join()


def cmd_evolve(args) -> None:
    from . import evolve
    evolve.run(args.generations, args.workers)


def cmd_force(args) -> None:
    """Evaluate one scripted patch through the same gate (used to show planned rejections, e.g. a locked edit)."""
    import json
    from . import evolve
    v = evolve.generation(args.workers, forced_patch={"patch": json.loads(args.patch), "rationale": args.rationale})
    print(v["version"], v["verdict"], v.get("verdict_reason"))


def _best_version() -> int:
    v = dbm.db().harness_versions.find_one({"status": {"$in": ["kept", "baseline"]}}, sort=[("scores.H", -1), ("version", -1)])
    return v["version"] if v else 0


def cmd_showcase(args) -> None:
    version = _best_version() if args.version is None else args.version
    batch_id = f"show-{args.order}-v{version}-{int(time.time())}"
    q.enqueue_batch(batch_id, version, [{"order_id": args.order, "suite": "story", "repeat": 0}], kind="showcase",
                    render=True)
    print(f"enqueued {batch_id}")
    if not args.enqueue_only:
        _worker([batch_id], True)


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:30] or "guest"


def cmd_live(args) -> None:
    """Turn judge requests from the web form into orders and pack them with the best harness."""
    from .truth import make_truth
    d = dbm.db()
    story = d.orders.find_one({"_id": "STORY"})
    print("waiting for live requests...", flush=True)
    while True:
        req = d.live_requests.find_one_and_update({"status": "new"}, {"$set": {"status": "queued"}})
        if not req:
            time.sleep(1)
            continue
        name, pid = req["name"].strip()[:40], req["product_id"]
        others = [it["product_id"] for it in story["items"] if it["product_id"] != pid][:2]
        oid = f"LIVE-{_slug(name)}-{int(time.time())}"
        order = {"_id": oid, "suite": "live", "customer": name, "seed": int(time.time()), "time_budget_s": story["time_budget_s"],
                 "items": [{"id": f"i{k}", "product_id": p} for k, p in enumerate([pid] + others)]}
        d.orders.insert_one(order)
        dbm.truth_db("seed").scene_truth.insert_many(
            [make_truth(oid, order["seed"], it["id"], it["product_id"]) for it in order["items"]])
        version = _best_version()
        batch_id = f"live-{oid}"
        q.enqueue_batch(batch_id, version, [{"order_id": oid, "suite": "live", "repeat": 0}], kind="live", render=True)
        d.live_requests.update_one({"_id": req["_id"]}, {"$set": {"order_id": oid, "batch_id": batch_id}})
        dbm.feed("info", f"New order for {name}: {catalog.BY_ID[pid].label} + {len(others)} more, packed by harness v{version}",
                 order_id=oid)
        if not args.enqueue_only:
            _worker([batch_id], True)


def cmd_demo_kill(args) -> None:
    """Live durability demo: pack the story order with rendering, kill -9 the worker mid-item, restart it,
    and show that it resumes from the Atlas checkpoint (attempt 2) with identical frames."""
    import os
    import signal
    import subprocess
    import sys
    os.environ["SKILLSMITH_DEMO"] = "1"
    version = _best_version() if args.version is None else args.version
    batch_id = f"demo-{args.order}-v{version}-{int(time.time())}"
    q.enqueue_batch(batch_id, version, [{"order_id": args.order, "suite": "story", "repeat": 0}], kind="showcase",
                    render=True)
    d = dbm.db()
    cmd = [sys.executable, "-m", "skillsmith.cli", "worker", "--batch", batch_id]
    env = {**os.environ, "SKILLSMITH_DEMO": "1"}
    print(f"night shift: packing {args.order} with harness v{version} (batch {batch_id})", flush=True)
    w1 = subprocess.Popen(cmd, env=env)
    target = f"{batch_id}:{args.order}:v{version}:r0:{args.kill_step}"
    while not d.work_queue.find_one({"_id": target, "status": "leased"}):
        time.sleep(0.2)
    time.sleep(args.kill_after)
    os.kill(w1.pid, signal.SIGKILL)
    w1.wait()
    print(f"\n*** kill -9 worker {w1.pid} in the middle of step {args.kill_step} ***\n", flush=True)
    step = d.work_queue.find_one({"_id": target})
    while True:
        left = (step["lease"]["expires_at"].replace(tzinfo=None) - dbm.now().replace(tzinfo=None)).total_seconds()
        if left <= 0:
            break
        print(f"  lease on step {args.kill_step} expires in {left:4.1f}s", flush=True)
        time.sleep(1)
    print("restarting the night shift...", flush=True)
    w2 = subprocess.Popen(cmd + ["--exit-when-idle"], env=env)
    w2.wait()
    rec = d.feed.find_one({"type": "recovery", "refs.order_run_id": {"$regex": f"^{batch_id}"}}, sort=[("ts", -1)])
    if rec:
        print(f"\n{rec['text']}", flush=True)
    run = d.runs.find_one({"batch_id": batch_id})
    print(f"order done: {run['damage_free']}/{run['n_items']} damage-free, video {run.get('video')}", flush=True)


def cmd_final_exam(args) -> None:
    """Final exam F (never-seen products), run once for v0 and the best version."""
    from . import evolve, gate
    d = dbm.db()
    best = _best_version()
    orders = [o["_id"] for o in d.orders.find({"suite": "F"}, {"_id": 1})]
    batch_id = f"final-{int(time.time())}"
    runs = [{"order_id": o, "suite": "F", "repeat": r, "version": v} for v in sorted({0, best}) for o in orders
            for r in range(2)]
    q.enqueue_batch(batch_id, best, runs, kind="eval")
    evolve.wait_batch(batch_id, args.workers)
    res = {}
    for v in sorted({0, best}):
        res[v] = gate.summarize(evolve._runs(v, "F", [batch_id]))["pct"]
        d.harness_versions.update_one({"version": v}, {"$set": {"scores.F": res[v]}})
    dbm.feed("verdict", f"Final exam (never-seen snacks): v0 {res[0]}% -> best v{best} {res[best]}% damage-free")
    print(res)


def cmd_status(args) -> None:
    for v in dbm.db().harness_versions.find({}, {"genome": 0}).sort("version", 1):
        s = v.get("scores", {})
        print(f"v{v['version']:<3} {v['status']:<12} H={s.get('H')} T={s.get('T')} cost={s.get('cost_usd')} "
              f"cycle={s.get('cycle_s')} | {v.get('patch_text')} | {v.get('verdict_reason', '')}")


def cmd_oracle(args) -> None:
    from . import oracle
    oracle.main(args.processes)


def main() -> None:
    ap = argparse.ArgumentParser(prog="skillsmith")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("seed"); s.add_argument("--reset", action="store_true"); s.set_defaults(fn=cmd_seed)
    s = sub.add_parser("worker"); s.add_argument("--batch", action="append"); s.add_argument("--n", type=int, default=1)
    s.add_argument("--exit-when-idle", action="store_true"); s.set_defaults(fn=cmd_worker)
    s = sub.add_parser("evolve"); s.add_argument("--generations", type=int, default=1)
    s.add_argument("--workers", type=int, default=8); s.set_defaults(fn=cmd_evolve)
    s = sub.add_parser("force"); s.add_argument("patch"); s.add_argument("--rationale", default="scripted check")
    s.add_argument("--workers", type=int, default=8); s.set_defaults(fn=cmd_force)
    s = sub.add_parser("showcase"); s.add_argument("--order", default="STORY"); s.add_argument("--version", type=int)
    s.add_argument("--enqueue-only", action="store_true"); s.set_defaults(fn=cmd_showcase)
    s = sub.add_parser("live"); s.add_argument("--enqueue-only", action="store_true"); s.set_defaults(fn=cmd_live)
    s = sub.add_parser("demo-kill"); s.add_argument("--order", default="STORY"); s.add_argument("--version", type=int)
    s.add_argument("--kill-step", type=int, default=2); s.add_argument("--kill-after", type=float, default=2.0)
    s.set_defaults(fn=cmd_demo_kill)
    s = sub.add_parser("final-exam"); s.add_argument("--workers", type=int, default=8); s.set_defaults(fn=cmd_final_exam)
    s = sub.add_parser("status"); s.set_defaults(fn=cmd_status)
    s = sub.add_parser("oracle"); s.add_argument("--processes", type=int, default=8); s.set_defaults(fn=cmd_oracle)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()

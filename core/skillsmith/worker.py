"""The night shift: claims queue steps and runs them. Every step's results commit in one Atlas transaction
together with the physics checkpoint, so a killed worker loses at most the step it was in the middle of."""
import hashlib
import json
import os
import subprocess
import time
import traceback
from pathlib import Path

import numpy as np

from . import catalog, memory, observe
from . import db as dbm
from . import queue as q
from .config import FRAME_DIR, VIDEO_DIR
from .executor import OrderSim
from .pipeline import judge_unpacked, order_view, record_plan, scene_spec
from .agents import coder

_cache: dict = {}


def _order(order_id: str) -> dict:
    if order_id not in _cache:
        _cache[order_id] = dbm.db().orders.find_one({"_id": order_id})
    return _cache[order_id]


def _truth(order_id: str) -> dict:
    """Referee path only."""
    key = ("truth", order_id)
    if key not in _cache:
        docs = dbm.truth_db("referee").scene_truth.find({"order_id": order_id}, {"_id": 0})
        _cache[key] = {t["item_id"]: t for t in docs}
    return _cache[key]


def _genome(version: int) -> dict:
    return dbm.db().harness_versions.find_one({"version": version})["genome"]


def sha1(*parts) -> str:
    return hashlib.sha1(":".join(map(str, parts)).encode()).hexdigest()


# ---------------------------------------------------------------- plan
def do_plan(step: dict) -> None:
    order, truth, genome = _order(step["order_id"]), _truth(step["order_id"]), _genome(step["version"])
    view = order_view(order, truth)
    lessons, skills = memory.retrieve_for_order(view, genome["retrieval"])
    d = dbm.db()
    err, cost, tokens, attempts, replayed = None, 0.0, 0, 0, False
    for attempt in range(1 + genome["retry"]["max_retries"]):
        prompt = coder.build_prompt(genome, view, lessons, skills, previous_error=err)
        call_key = sha1(step["version"], step["order_id"], step["repeat"], attempt, sha1(prompt))
        hit = d.llm_ledger.find_one({"call_key": call_key, "status": "committed"})
        if hit:
            out, replayed = hit["response"], True
        else:
            d.llm_ledger.update_one({"call_key": call_key}, {"$setOnInsert": {"status": "pending", "created_at": dbm.now()}},
                                    upsert=True)
            out = coder.write_program(genome, prompt)
            d.llm_ledger.update_one({"call_key": call_key}, {"$set": {
                "status": "committed", "response": out, "cost_usd": out["cost_usd"], "model": out["model"],
                "committed_at": dbm.now()}})
        cost += 0.0 if replayed else out["cost_usd"]
        tokens += out["tokens_in"] + out["tokens_out"]
        attempts += 1
        rec = record_plan(out["code"], order, truth, genome["tools"])
        err = rec["error"]
        if err is None:
            break
    if rec["gaps"] and step["suite"] in ("T", "story", "live"):
        for g in rec["gaps"]:
            dbm.feed("gap", f"Coder asked: \"{g}\"", version=step["version"], order_id=step["order_id"])
    run = {
        "batch_id": step["batch_id"], "version": step["version"], "order_id": step["order_id"],
        "suite": step["suite"], "repeat": step["repeat"], "customer": order["customer"],
        "plan_code": out["code"], "model": out["model"], "actions": rec["actions"], "tool_calls": rec["tool_calls"],
        "gaps": rec["gaps"], "plan_error": rec["error"], "tool_time_s": rec["tool_time_s"],
        "retrieved": {"lessons": [l["text"] for l in lessons], "skills": [s["text"] for s in skills]},
        "cost_usd": round(cost, 6), "tokens": tokens, "llm_attempts": attempts, "llm_replayed": replayed,
        "items": [], "status": "running", "created_at": dbm.now(), "video": None,
    }
    q.commit(step, lambda s: d.runs.replace_one({"_id": step["order_run_id"]}, {"_id": step["order_run_id"], **run},
                                                upsert=True, session=s))


# ---------------------------------------------------------------- place
def _frame_path(orid: str, step_idx: int, tag: str) -> Path:
    return FRAME_DIR / f"{orid.replace(':', '_')}_{step_idx}_{tag}.png"


def _renderer(sim: OrderSim):
    from .render import Renderer
    return Renderer(sim.model, 960, 540)


def do_place(step: dict) -> None:
    d = dbm.db()
    run = d.runs.find_one({"_id": step["order_run_id"]})
    order, truth, genome = _order(step["order_id"]), _truth(step["order_id"]), _genome(step["version"])
    k = step["step_idx"] - 1  # action index
    sim = OrderSim(scene_spec(order, truth), genome["defaults"]["carry_height_mm"] / 1000)
    sim.tool_time = run["tool_time_s"]
    prev = d.checkpoints.find_one({"order_run_id": step["order_run_id"], "step_idx": step["step_idx"] - 1})
    if prev:
        sim.restore(prev["snapshot"])
    render = step.get("render", False)
    if render and step["attempts"] > 1 and prev and prev.get("frame"):
        _report_recovery(step, sim, prev)
    if k >= len(run["actions"]):
        _commit_checkpoint(step, sim, run, verdicts=None, render=False)
        return
    action = run["actions"][k]
    rec = None
    if render:
        from .render import Recorder
        clip = VIDEO_DIR / "clips" / f"{step['order_run_id'].replace(':', '_')}_{step['step_idx']}.mp4"
        rec = Recorder(sim.model, sim.data, clip, fps=24, width=960, height=540)
        sim.robot.observers.append(rec)
    sim.run_item(action)
    over = sim.elapsed_s() > order["time_budget_s"]
    verdicts = {}
    for a in run["actions"][: k + 1]:
        prev_v = next((v for v in run["items"] if v["id"] == a["item"]), None)
        is_over = over if a["item"] == action["item"] else bool(prev_v and prev_v.get("family") == "over_budget")
        verdicts[a["item"]] = sim.judge(a["item"], over_budget=is_over)
    if rec:
        sim.tint(rec.renderer, list(verdicts.values()))
        rec.hold(0.6)
        rec.close()
    _commit_checkpoint(step, sim, run, verdicts, render, clip=str(rec.path) if rec else None)


def _commit_checkpoint(step, sim, run, verdicts, render, clip=None):
    d = dbm.db()
    snap = sim.snapshot()
    frame_web = None
    if render:
        path = _frame_path(step["order_run_id"], step["step_idx"], "ckpt")
        _renderer(sim).save_png(sim.data, path)
        frame_web = f"/frames/{path.name}"
    labels = {it["id"]: catalog.BY_ID[it["product_id"]].label for it in _order(step["order_id"])["items"]}
    pids = {it["id"]: it["product_id"] for it in _order(step["order_id"])["items"]}
    items = None
    if verdicts is not None:
        items = [{**v, "label": labels[v["id"]], "product_id": pids[v["id"]]} for v in verdicts.values()]

    def writes(s):
        d.checkpoints.replace_one(
            {"_id": f"{step['order_run_id']}:{step['step_idx']}"},
            {"_id": f"{step['order_run_id']}:{step['step_idx']}", "order_run_id": step["order_run_id"],
             "step_idx": step["step_idx"], "snapshot": snap, "sim_time": float(sim.data.time),
             "elapsed_s": sim.elapsed_s(), "frame": frame_web, "attempt": step["attempts"], "created_at": dbm.now()},
            upsert=True, session=s)
        upd = {"cycle_s": round(sim.elapsed_s(), 2), "last_step": step["step_idx"]}
        if items is not None:
            upd["items"] = items
        if clip:
            d.runs.update_one({"_id": step["order_run_id"]}, {"$push": {"clips": clip}}, session=s)
        d.runs.update_one({"_id": step["order_run_id"]}, {"$set": upd}, session=s)
    q.commit(step, writes)


def _report_recovery(step, sim, prev):
    """Show the last committed frame before the crash next to the first frame after restoring."""
    from PIL import Image
    after = _frame_path(step["order_run_id"], step["step_idx"] - 1, f"restored_a{step['attempts']}")
    _renderer(sim).save_png(sim.data, after)
    before = FRAME_DIR / Path(prev["frame"]).name
    try:
        a = np.asarray(Image.open(before), dtype=np.int16)
        b = np.asarray(Image.open(after), dtype=np.int16)
        diff = int(np.abs(a - b).sum())
    except Exception:
        diff = -1
    ts = prev["created_at"].strftime("%H:%M:%S")
    dbm.feed("recovery", f"Recovered order {step['order_id']} step {step['step_idx']} from checkpoint {ts} "
             f"(attempt {step['attempts']}); pixel diff {diff}",
             order_run_id=step["order_run_id"], step_idx=step["step_idx"], attempt=step["attempts"],
             before_frame=prev["frame"], after_frame=f"/frames/{after.name}", pixel_diff=diff)


# ---------------------------------------------------------------- verify
def do_verify(step: dict) -> None:
    d = dbm.db()
    run = d.runs.find_one({"_id": step["order_run_id"]})
    order = _order(step["order_id"])
    items = list(run["items"]) + judge_unpacked(order, run["actions"], run.get("plan_error"))
    for v in items:
        if "label" not in v:
            p = next(it["product_id"] for it in order["items"] if it["id"] == v["id"])
            v.update(label=catalog.BY_ID[p].label, product_id=p)
    run.update(items=items, damage_free=sum(bool(v["ok"]) for v in items), n_items=len(order["items"]))
    genome = _genome(step["version"])
    eid = observe.report_run(run, _genome_summary(genome))
    video = None
    if run.get("clips"):
        video = _stitch(run["clips"], step["order_run_id"])
    # Skills: clean packs of training products (never held-out ones) become reusable skill docs.
    if step["suite"] == "T":
        for v in items:
            if v["ok"]:
                a = next(a for a in run["actions"] if a["item"] == v["id"])
                _upsert_skill(v["product_id"], a, step["version"], step["order_run_id"])

    def writes(s):
        d.runs.update_one({"_id": step["order_run_id"]}, {"$set": {
            "items": items, "damage_free": run["damage_free"], "n_items": run["n_items"], "status": "done",
            "raindrop_event_id": eid, "video": video, "finished_at": dbm.now()}}, session=s)
    q.commit(step, writes)


def _genome_summary(g: dict) -> str:
    tools = [t for t, on in g["tools"].items() if on]
    return (f"rules={len(g['rules'])} tools={tools or 'none'} lessons_k={g['retrieval']['lessons_k']} "
            f"skills_k={g['retrieval']['skills_k']} carry={g['defaults']['carry_height_mm']}mm")


def _upsert_skill(product_id: str, action: dict, version: int, source: str) -> None:
    p = catalog.BY_ID[product_id]
    sid = f"skill:{product_id}:{action['grip']}:{action['speed']}"
    d = dbm.db()
    if d.memory.find_one({"_id": sid}, {"_id": 1}):
        d.memory.update_one({"_id": sid}, {"$inc": {"uses": 1}})
        return
    text = (f"{p.label} ({p.description}, about {catalog.visible(product_id)['approx_size_mm']} mm): packed clean "
            f"with grip='{action['grip']}', speed='{action['speed']}'.")
    vec = memory.embed([text])[0]
    d.memory.update_one({"_id": sid}, {"$setOnInsert": {
        "kind": "skill", "text": text, "embedding": vec, "active": True, "class": p.cls, "family": None,
        "product_id": product_id, "grip": action["grip"], "speed": action["speed"], "uses": 1,
        "version_created": version, "source_run": source, "created_at": dbm.now()}}, upsert=True)


def _stitch(clips: list[str], orid: str) -> str | None:
    clips = [c for c in clips if os.path.exists(c)]
    if not clips:
        return None
    out = VIDEO_DIR / f"{orid.replace(':', '_')}.mp4"
    lst = out.with_suffix(".txt")
    lst.write_text("".join(f"file '{c}'\n" for c in clips))
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy",
                    str(out)], check=False)
    lst.unlink(missing_ok=True)
    return f"/videos/{out.name}" if out.exists() else None


# ---------------------------------------------------------------- loop
HANDLERS = {"plan": do_plan, "place": do_place, "verify": do_verify}


def run_step(step: dict) -> None:
    with q.Heartbeat(step) as hb:
        HANDLERS[step["kind"]](step)
        if hb.lost:
            raise q.LostLease("lease lost during step")


def loop(batch_ids: list[str] | None = None, exit_when_idle: bool = False, idle_s: float = 0.5,
         verbose: bool = True) -> None:
    idle_since = None
    while True:
        step = q.claim(batch_ids)
        if step is None:
            if exit_when_idle:
                if idle_since is None:
                    idle_since = time.time()
                if time.time() - idle_since > 3:
                    return
            time.sleep(idle_s)
            continue
        idle_since = None
        t0 = time.time()
        try:
            run_step(step)
            if verbose:
                print(f"[{q.OWNER}] {step['_id']} {step['kind']} done in {time.time() - t0:.1f}s"
                      + (f" (attempt {step['attempts']})" if step["attempts"] > 1 else ""), flush=True)
        except q.LostLease as e:
            print(f"[{q.OWNER}] {e}", flush=True)
        except Exception as e:
            traceback.print_exc()
            if step["attempts"] < 3:
                dbm.db().work_queue.update_one({"_id": step["_id"], "lease.token": step["lease"]["token"]},
                                               {"$set": {"status": "pending", "lease": None}})
            else:
                _give_up(step, f"{type(e).__name__}: {e}")


def _give_up(step: dict, error: str) -> None:
    """Mark the step failed and close out the rest of its order run so the batch can finish."""
    d = dbm.db()
    q.fail(step, error)
    d.work_queue.update_many({"order_run_id": step["order_run_id"], "status": {"$in": ["pending", "leased"]}},
                             {"$set": {"status": "done", "skipped": True, "waiting_on": [], "lease": None}})
    d.runs.update_one({"_id": step["order_run_id"]}, {"$set": {"status": "failed", "error": error[:300]}})
    d.work_queue.update_one({"_id": step["_id"]}, {"$set": {"status": "done", "skipped": True}})

"""Export one recorded run from Atlas as the web screen's Story (web/src/lib/story/types.ts).

Everything comes from the database: kept versions and their genomes, the showcase run of one order per kept version
(program, retrieved memory, actions, referee verdicts, per-item clips), and the gate's numbers. The meta-agent's
investigation is what it actually read (the Raindrop read-back logged in the feed, plus its optional Atlas query);
nothing is illustrative, so `sample` is false.
"""
import json
import subprocess
from pathlib import Path

from . import catalog, gate, observe
from . import db as dbm
from .config import REPO_DIR

MODEL_NAMES = {"anthropic/claude-haiku-5.5": "Haiku 5.5", "anthropic/claude-sonnet-5.5": "Sonnet 5.5"}
LABELS = {v: k for k, v in observe.SIGNAL_LABELS.items()}
SIGNAL_LABEL = observe.SIGNAL_LABELS
PATH_OF = {"set_retrieval": "retrieval", "set_default": "defaults", "set_retry": "retry", "enable_tool": "tools",
           "disable_tool": "tools", "add_rule": "rules", "remove_rule": "rules", "set_model": "models"}


def _model(mid: str) -> str:
    return MODEL_NAMES.get(mid, mid.split("/")[-1])


def _duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True).stdout.strip()
    return round(float(out or 0), 2)


def _genome(v: dict) -> dict:
    g = v["genome"]
    return {"models": {r: _model(m) for r, m in v["models"].items()}, "rules": g["rules"], "tools": g["tools"],
            "retrieval": g["retrieval"], "defaults": g["defaults"], "retry": g["retry"], "helpers": [],
            "critic_focus": None, "locked": g["locked"]}


def _scores(v: dict) -> dict:
    s = v["scores"]
    return {"T": s["T"], "H": s["H"], "cycle_s": s["cycle_s"], "cost_usd": s["cost_usd"],
            "by_family": {f: n for f, n in s.get("by_family", {}).items() if n}}


def _why(label: str, product_id: str, action: dict, run: dict) -> dict:
    tools = [t for t in run.get("tool_calls", []) if t["item"] == action["item"]]
    if tools:
        return {"source": "tool", "text": "; ".join(f"{t['tool']} said {t['answer']}" for t in tools)}
    skills = [s for s in run["retrieved"]["skills"] if s.startswith(label)]
    if skills:
        return {"source": "skill", "text": f"{len(skills)} proven skill(s) for this product were in the prompt, e.g. "
                                          f"\"{skills[0].split(': ', 1)[-1]}\""}
    if run["retrieved"]["lessons"]:
        return {"source": "lesson", "text": run["retrieved"]["lessons"][0]}
    return {"source": "guess", "text": "No memory in the prompt; the coder estimated the grip from the gripper "
                                       "datasheet rule and the description."}


def _run(run: dict, order: dict) -> dict:
    items = {it["id"]: it for it in order["items"]}
    verdicts = {v["id"]: v for v in run["items"]}
    clips = sorted(run.get("clips", []))
    steps = []
    for k, a in enumerate(run["actions"]):
        it = items[a["item"]]
        p = catalog.BY_ID[it["product_id"]]
        v = verdicts[a["item"]]
        clip = Path(clips[k]) if k < len(clips) else None
        steps.append({
            "kind": "place",
            "item": {"id": it["id"], "product_id": p.id, "label": p.label},
            "action": {"grip": f"{a['grip_N']:g} N", "grip_N": a["grip_N"], "speed": f"{a['speed_mps']:g} m/s",
                       "speed_mps": a["speed_mps"], "slot": a["slot"], "on_top_of": None},
            "why": _why(p.label, p.id, a, run),
            "clip": {"src": f"/videos/clips/{clip.name}" if clip else "", "duration_s": _duration(clip) if clip else 0},
            "result": {"ok": bool(v["ok"]), "family": v["family"], "detail": v["detail"] or "packed clean",
                       "peak_N": v.get("peak_N"), "tilt_deg": v.get("tilt_deg"), "condition": v.get("inspected")},
        })
    signals = [{"name": SIGNAL_LABEL[observe.FAMILY_SIGNAL[v["family"]]] if v["family"] else "Packed clean",
                "item": v["label"], "polarity": "negative" if v["family"] else "positive"} for v in run["items"]]
    signals += [{"name": "Capability gap", "item": None, "polarity": "feedback"} for _ in run.get("gaps", [])]
    return {"id": run["_id"],
            "plan": {"model": _model(run["model"]), "code": run["plan_code"], "retrieved": run["retrieved"],
                     "tool_calls": [{"tool": t["tool"], "item": t["item"], "result": str(t["answer"]), "time_s": 3}
                                    for t in run.get("tool_calls", [])],
                     "gaps": run.get("gaps", [])},
            "steps": steps,
            "verify": {"damage_free": run["damage_free"], "n_items": run["n_items"], "cycle_s": run["cycle_s"],
                       "signals": signals}}


def _transition(a: dict, b: dict) -> dict:
    d = dbm.db()
    sig = d.feed.find_one({"type": "signal", "refs.version": a["version"]}, sort=[("ts", -1)])
    investigate = []
    if sig:
        investigate.append({"tool": "query_signals", "args": f"v{a['version']}, training orders",
                            "result": sig["text"].split(": ", 1)[-1], "source": sig["refs"].get("source", "atlas")})
    q = (b.get("meta") or {}).get("query")
    if q:
        n = len(q["result"]) if isinstance(q["result"], list) else q["result"]
        investigate.append({"tool": "query_atlas", "args": json.dumps(q["query"])[:120],
                            "result": f"{n} documents" if isinstance(n, int) else str(n)[:160], "source": "atlas"})
    op, args = b["patch"]["op"], b["patch"].get("args", {})
    key = next(iter(args), "")
    section = PATH_OF.get(op, op)
    before = a["genome"].get(section, {})
    before = before.get(key) if isinstance(before, dict) else before
    sa, sb = a["scores"], b["scores"]
    fam_up = {f: round(sb["by_family"].get(f, 0) - sa["by_family"].get(f, 0), 1) for f in gate.FAMILIES}
    worst = max(fam_up.items(), key=lambda kv: kv[1])
    cyc = sb["cycle_s"] / max(sa["cycle_s"], 1e-6)
    cost = sb["cost_usd"] / max(sa["cost_usd"], 1e-9)
    tried = d.harness_versions.count_documents({"version": {"$gt": a["version"], "$lt": b["version"]}})
    reason = b["verdict_reason"][:1].upper() + b["verdict_reason"][1:]
    if tried:
        reason += (f". {tried} earlier patch{'es were' if tried > 1 else ' was'} tried from v{a['version']} and "
                   f"rolled back first")
    return {
        "from": a["version"], "to": b["version"], "model": _model(b["meta"]["model"]), "sample": False,
        "signals": {"source": "raindrop" if sig and sig["refs"].get("source") == "raindrop" else "atlas",
                    "failures": [{"family": f, "label": SIGNAL_LABEL[observe.FAMILY_SIGNAL[f]], "count": n}
                                 for f, n in sa["by_family"].items() if n],
                    "memory": {"skills": d.memory.count_documents({"kind": "skill", "version_created": {"$lte": a["version"]}}),
                               "lessons": d.memory.count_documents({"kind": "lesson", "version_created": {"$lte": a["version"]}})}},
        "investigate": investigate,
        "hypothesis": b["rationale"],
        "patch": {"op": op, "path": f"{section}.{key}" if key else section, "before": str(before), "after": str(args.get(key)),
                  "rationale": b["rationale"], "predicted_effect": b["predicted_effect"]},
        "gate": {"T": [sa["T"], sb["T"]], "H": [sb.get("incumbent_H_control", sa["H"]), sb["H"]],
                 "p_better": sb.get("p_better", 0.0),
                 "guardrails": [
                     {"name": "Held-out not down", "ok": sb.get("delta_H", 0) >= 0, "detail": f"{sb.get('delta_H', 0):+.1f} pts (paired)"},
                     {"name": "No family regresses > 1 item", "ok": worst[1] <= 1.0, "detail": f"worst: {worst[0]} {worst[1]:+.1f}"},
                     {"name": "Cycle time ≤ +20%", "ok": cyc <= 1.2, "detail": f"{sa['cycle_s']:.1f} s → {sb['cycle_s']:.1f} s"},
                     {"name": "Cost ≤ 2×", "ok": cost <= 2.0, "detail": f"{cost:.2f}×"}]},
        "verdict": {"status": b["verdict"], "reason": reason},
        "cost_usd": round(b["meta"]["cost_usd"], 4),
    }


def export(order_id: str, out: Path, title: str, goal: str) -> dict:
    d = dbm.db()
    order = d.orders.find_one({"_id": order_id})
    kept = list(d.harness_versions.find({"status": {"$in": ["baseline", "kept"]}}).sort("version", 1))
    versions = []
    for v in kept:
        run = d.runs.find_one({"suite": "story", "order_id": order_id, "version": v["version"],
                               "_id": {"$regex": f"^show-{order_id}-v{v['version']}-"}, "status": "done"},
                              sort=[("created_at", -1)])
        if run is None:
            raise SystemExit(f"no showcase run of {order_id} for v{v['version']}: run `skillsmith showcase --order "
                             f"{order_id} --version {v['version']}` first")
        versions.append({"version": v["version"], "patch_text": v["patch_text"], "genome": _genome(v),
                         "scores": _scores(v), "run": _run(run, order)})
    story = {
        "source": "db",
        "objective": {"title": title, "customer": order["customer"], "time_budget_s": order["time_budget_s"],
                      "goal": goal},
        "order": {"id": order_id, "items": [{"id": it["id"], "product_id": it["product_id"],
                                             "label": catalog.BY_ID[it["product_id"]].label} for it in order["items"]]},
        "versions": versions,
        "transitions": [_transition(a, b) for a, b in zip(kept, kept[1:])],
    }
    out.write_text(json.dumps(story, indent=1, default=str))
    return story


DEFAULT_OUT = REPO_DIR / "web" / "public" / "story_v2.json"

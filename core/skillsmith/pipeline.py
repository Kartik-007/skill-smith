"""Plan and execute one order. The durable worker calls these same functions one step at a time."""
from pathlib import Path

from . import catalog
from .agents import coder
from .executor import OrderSim, UnstableSim
from .skill_api import RecordingAPI, run_program


def order_view(order: dict, truth: dict) -> dict:
    rec = RecordingAPI(order, truth, {})
    return {"customer": order["customer"], "time_budget_s": order["time_budget_s"], "items": rec.items()}


def scene_spec(order: dict, truth: dict) -> dict:
    from .scene import STAGING
    return {
        "items": [{"id": it["id"], "product_id": it["product_id"], "stage_pos": [float(v) for v in STAGING[k]]}
                  for k, it in enumerate(order["items"])],
        "truth": {iid: {k: t[k] for k in ("mass_kg", "friction", "com_offset_m", "crush_limit_N")}
                  for iid, t in truth.items()},
    }


def record_plan(code: str, order: dict, truth: dict, tools: dict) -> dict:
    rec = RecordingAPI(order, truth, tools)
    err = run_program(code, rec)
    return {"actions": rec.actions, "tool_calls": rec.tool_calls, "gaps": rec.gaps, "error": err,
            "tool_time_s": rec.tool_time_s()}


def plan(order: dict, truth: dict, genome: dict, lessons: list[dict], skills: list[dict]) -> dict:
    """LLM writes the program; the recording API turns it into an action list. Retries per genome."""
    view = order_view(order, truth)
    err, cost, tokens, attempts = None, 0.0, 0, 0
    for attempt in range(1 + genome["retry"]["max_retries"]):
        prompt = coder.build_prompt(genome, view, lessons, skills, previous_error=err)
        out = coder.write_program(genome, prompt)
        cost += out["cost_usd"]
        tokens += out["tokens_in"] + out["tokens_out"]
        attempts += 1
        rec = record_plan(out["code"], order, truth, genome["tools"])
        err = rec["error"]
        if err is None:
            break
    return {"code": out["code"], "prompt": prompt, "model": out["model"], "cost_usd": round(cost, 6),
            "tokens": tokens, "attempts": attempts, **rec}


def judge_unpacked(order: dict, actions: list[dict], error: str | None) -> list[dict]:
    done = {a["item"] for a in actions}
    return [{"id": it["id"], "ok": False, "family": "in_box",
             "detail": "never packed" + (f" (program error: {error})" if error else ""),
             "peak_N": 0.0, "tilt_deg": 0.0, "in_box": False}
            for it in order["items"] if it["id"] not in done]


def execute(order: dict, truth: dict, plan_rec: dict, carry_height_mm: int, video: Path | None = None) -> dict:
    """Run the whole action list in one go (oracle and quick evaluation). Returns per-item verdicts."""
    sim = OrderSim(scene_spec(order, truth), carry_height_mm / 1000)
    sim.tool_time = plan_rec["tool_time_s"]
    rec = None
    if video:
        from .render import Recorder
        rec = Recorder(sim.model, sim.data, video, fps=24, width=960, height=540)
        sim.robot.observers.append(rec)
    verdicts = []
    try:
        for a in plan_rec["actions"]:
            sim.run_item(a)
            verdicts.append(sim.judge(a["item"], over_budget=sim.elapsed_s() > order["time_budget_s"]))
    except UnstableSim as e:
        done = {v["id"] for v in verdicts}
        verdicts += [{"id": a["item"], "ok": False, "family": "collision", "detail": f"physics unstable: {e}",
                      "peak_N": 0.0, "tilt_deg": 0.0, "in_box": False} for a in plan_rec["actions"] if a["item"] not in done]
    if rec:
        sim.tint(rec.renderer, verdicts)
        rec.hold(1.5)
        rec.close()
    verdicts += judge_unpacked(order, plan_rec["actions"], plan_rec.get("error"))
    labels = {it["id"]: catalog.BY_ID[it["product_id"]].label for it in order["items"]}
    for v in verdicts:
        v["label"] = labels[v["id"]]
        v["product_id"] = next(it["product_id"] for it in order["items"] if it["id"] == v["id"])
    return {"items": verdicts, "damage_free": sum(v["ok"] for v in verdicts), "n_items": len(order["items"]),
            "cycle_s": round(sim.elapsed_s(), 2)}

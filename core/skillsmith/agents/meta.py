"""Meta-agent: reads the signals (Raindrop + Atlas aggregates), the capability gaps the coder reported, the
current genome and past verdicts, and proposes exactly ONE typed patch to the harness genome."""
import json

from .. import llm
from ..config import STRONG_MODEL
from ..genome import PATCH_OPS

SYSTEM = """You improve the harness around a cheap LLM that writes packing programs for a robot arm.
You can't change the model's weights or the robot. You change the harness config ("genome") with exactly ONE patch
per generation. A gate will evaluate your patch against the incumbent on training and held-out orders and keep it
only if it clearly helps without regressions, extra cost or slower cycles.

Patch whitelist (op -> args):
- add_rule {text <= 200 chars}: a standing instruction for the coder (max 8 rules)
- remove_rule {index}
- enable_tool / disable_tool {name: "weigh" | "squeeze_test" | "surface_check"}: noisy readings for the coder:
  weigh -> kg (+/-12%), squeeze_test -> newtons per finger the packaging takes before giving (+/-25%),
  surface_check -> dry/damp (10% wrong). Each tool call costs 3 s of the order's time budget.
- set_retrieval {exactly ONE of: lessons_k 0-5 | skills_k 0-5 | min_score 0-1}: how many critic lessons / proven
  per-product skills (both stored in Atlas Vector Search) are retrieved into the coder's prompt
- set_default {exactly ONE of: carry_height_mm 80-300 | speed_mps 0.1-1.0 (the coder's default arm speed)}
One knob per patch, so the gate can attribute the effect; multi-knob patches are rejected by the validator.
- set_retry {max_retries 0-2}: re-ask the coder when its program errors
- set_model {role coder|critic|meta, tier cheap|strong}
Anything in genome.locked is a safety guardrail and can't be changed.

Before deciding you may request ONE read-only query to look at data, by replying with JSON
{"query": {"database": str, "collection": str, "filter": {}}} and nothing else. Otherwise reply with JSON only:
{"op": str, "args": {...}, "rationale": str (<= 300 chars), "predicted_effect": str (<= 160 chars)}"""


def _context(ctx: dict) -> str:
    return json.dumps(ctx, default=str, indent=1)[:12000]


def _parse(text: str) -> dict:
    try:
        data = json.loads(llm.extract_json(text))
    except Exception:
        return {}
    if isinstance(data.get("patch"), dict) and "op" not in data:
        data = {**data["patch"], **{k: v for k, v in data.items() if k != "patch"}}
    return data


def _ask(user: str, stub: str) -> tuple[dict, dict, float]:
    cost = 0.0
    for attempt in range(2):
        out = llm.chat(STRONG_MODEL, SYSTEM, user if attempt == 0 else user + "\n\nReply with the JSON only.",
                       temperature=0.4, max_tokens=4000, stub=stub)
        cost += out["cost_usd"]
        data = _parse(out["text"])
        if data.get("op") or data.get("query"):
            return data, out, cost
    return data, out, cost


def propose(ctx: dict, run_query) -> dict:
    """ctx: genome, history, family rates, signals, gaps, memory stats, databases. run_query(q) -> result or error."""
    stub = json.dumps({"op": "add_rule", "args": {"text": "Use at most 6 N per finger on thin cartons."},
                       "rationale": "stub", "predicted_effect": "fewer crushes"})
    user = "Current state:\n" + _context(ctx)
    data, out, cost = _ask(user, stub)
    query_log = None
    if "query" in data and not data.get("op"):
        result = run_query(data["query"])
        query_log = {"query": data["query"], "result": result}
        user2 = user + "\n\nYour query:\n" + json.dumps(data["query"]) + "\nResult:\n" + json.dumps(result, default=str)[:4000] + \
            "\n\nNow reply with the patch JSON only."
        data, out, c2 = _ask(user2, stub)
        cost += c2
    patch = {"op": data.get("op"), "args": data.get("args") or {}}
    return {"patch": patch, "rationale": str(data.get("rationale", ""))[:400],
            "predicted_effect": str(data.get("predicted_effect", ""))[:200], "cost_usd": cost, "model": out["model"],
            "query": query_log, "raw": out["text"][:2000]}


MAX_TOOL_CALLS = 6

TOOLS_SYSTEM = """

You have read-only tools; use the query_atlas tool instead of the JSON query reply described above. Before
proposing, investigate: Raindrop holds one pack_order event per order run, with
signals (crushed, slipped, collision, tipped, over_budget, not_in_box, packed_clean), the coder's program, and one
harness_patch event per past generation. Use count_signal / compare_versions to size a problem, find_events and
get_event to read the programs and item verdicts behind it, list_gaps for what the coder said it was missing,
gate_history for what was already tried, and query_atlas for anything else in the harness database. You get at most
""" + str(MAX_TOOL_CALLS) + """ tool calls. Then reply with the patch JSON only, adding "evidence": a list of the
event ids or tool results (short strings) your patch relies on."""


def propose_investigating(ctx: dict, query_atlas, on_call=None, extra_system: str = "") -> dict:
    """Like propose(), but the meta-agent reads Raindrop itself through tools (raindrop_tools) before its one
    patch. query_atlas(q) is evolve's tripwire-logging wrapper; on_call(name, args, result) lets evolve log each
    call to the feed. In stub mode there's no model to call tools, so this falls back to propose()."""
    from .. import raindrop_tools as rt
    if llm.STUB:
        return {**propose(ctx, query_atlas), "investigation": [], "evidence": []}
    messages = [{"role": "system", "content": SYSTEM + TOOLS_SYSTEM + extra_system},
                {"role": "user", "content": "Current state:\n" + _context(ctx)}]
    transcript, cost, model, data, text = [], 0.0, STRONG_MODEL, {}, ""
    for _ in range(MAX_TOOL_CALLS + 3):  # tool turns, then the answer (with one retry if it isn't JSON)
        budget_left = MAX_TOOL_CALLS - len(transcript)
        out = llm.chat_tools(STRONG_MODEL, messages, rt.SCHEMAS if budget_left > 0 else None, max_tokens=4000)
        cost += out["cost_usd"]
        model = out["model"]
        messages.append(out["message"])
        if out["tool_calls"]:
            for call in out["tool_calls"]:
                if len(transcript) >= MAX_TOOL_CALLS:
                    result = {"error": "tool budget used up; reply with the patch JSON now"}
                else:
                    result = rt.run(call["name"], call["args"], query_atlas)
                    transcript.append({"tool": call["name"], "args": call["args"],
                                       "result": json.loads(json.dumps(result, default=str))})
                    if on_call:
                        on_call(call["name"], call["args"], result)
                messages.append({"role": "tool", "tool_call_id": call["id"],
                                 "content": json.dumps(result, default=str)[:6000]})
            if len(transcript) >= MAX_TOOL_CALLS:
                messages.append({"role": "user", "content": "Tool budget used. Reply with the patch JSON only."})
            continue
        text = out["text"]
        data = _parse(text)
        if data.get("op"):
            break
        messages.append({"role": "user", "content": "Reply with the patch JSON only."})
    patch = {"op": data.get("op"), "args": data.get("args") or {}}
    evidence = data.get("evidence") if isinstance(data.get("evidence"), list) else []
    return {"patch": patch, "rationale": str(data.get("rationale", ""))[:400],
            "predicted_effect": str(data.get("predicted_effect", ""))[:200], "cost_usd": cost, "model": model,
            "query": None, "investigation": transcript, "evidence": [str(e)[:200] for e in evidence[:8]],
            "raw": text[:2000]}


__all__ = ["propose", "propose_investigating", "PATCH_OPS"]

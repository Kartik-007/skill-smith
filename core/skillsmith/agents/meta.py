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
- enable_tool / disable_tool {name: "weigh" | "squeeze_test"}: weigh -> light/medium/heavy, squeeze_test ->
  firm/gives slightly/soft. Each tool call costs 3 s of the order's time budget.
- set_retrieval {lessons_k 0-5, skills_k 0-5, min_score 0-1}: how many critic lessons / proven per-product skills
  (both stored in Atlas Vector Search) are retrieved into the coder's prompt
- set_default {carry_height_mm 80-300, speed slow|normal|fast}
- set_retry {max_retries 0-2}: re-ask the coder when its program errors
- set_model {role coder|critic|meta, tier cheap|strong}
Anything in genome.locked is a safety guardrail and can't be changed.

Before deciding you may request ONE read-only query to look at data, by replying with JSON
{"query": {"database": str, "collection": str, "filter": {}}} and nothing else. Otherwise reply with JSON only:
{"op": str, "args": {...}, "rationale": str (<= 300 chars), "predicted_effect": str (<= 160 chars)}"""


def _context(ctx: dict) -> str:
    return json.dumps(ctx, default=str, indent=1)[:12000]


def propose(ctx: dict, run_query) -> dict:
    """ctx: genome, history, family rates, signals, gaps, memory stats, databases. run_query(q) -> result or error."""
    stub = json.dumps({"op": "add_rule", "args": {"text": "Use grip='soft' for thin cartons and fragile snacks."},
                       "rationale": "stub", "predicted_effect": "fewer crushes"})
    user = "Current state:\n" + _context(ctx)
    out = llm.chat(STRONG_MODEL, SYSTEM, user, temperature=0.4, max_tokens=700, stub=stub)
    cost = out["cost_usd"]
    query_log = None
    try:
        data = json.loads(llm.extract_json(out["text"]))
    except Exception:
        data = {}
    if "query" in data:
        result = run_query(data["query"])
        query_log = {"query": data["query"], "result": result}
        user2 = user + "\n\nYour query:\n" + json.dumps(data["query"]) + "\nResult:\n" + json.dumps(result, default=str)[:4000] + \
            "\n\nNow reply with the patch JSON only."
        out = llm.chat(STRONG_MODEL, SYSTEM, user2, temperature=0.4, max_tokens=700, stub=stub)
        cost += out["cost_usd"]
        try:
            data = json.loads(llm.extract_json(out["text"]))
        except Exception:
            data = {}
    patch = {"op": data.get("op"), "args": data.get("args") or {}}
    return {"patch": patch, "rationale": str(data.get("rationale", ""))[:400],
            "predicted_effect": str(data.get("predicted_effect", ""))[:200], "cost_usd": cost, "model": out["model"],
            "query": query_log, "raw": out["text"][:2000]}


__all__ = ["propose", "PATCH_OPS"]

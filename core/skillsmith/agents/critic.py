"""Critic: turns referee traces of failed training orders into at most 3 short, general lessons."""
import json

from .. import llm
from ..config import STRONG_MODEL

SYSTEM = (
    "You review a warehouse packing robot's failures and write short, general lessons for its program writer. "
    "You only see what the referee reports (failure family, product, the grip and speed used, coarse force band, tool "
    "answers). Write lessons that generalise to similar products by packaging type, not product-specific trivia. "
    "Reply with JSON only: {\"lessons\": [{\"text\": str (<= 160 chars), \"product_class\": str, \"family\": str}]} "
    "with at most 3 lessons, most important first. Do not repeat known lessons."
)


def write_lessons(failures: list[dict], known: list[str]) -> dict:
    user = ("Known lessons (don't repeat):\n" + ("\n".join(f"- {k}" for k in known) or "- none") +
            "\n\nFailed items from the last batch (one per line, JSON):\n" +
            "\n".join(json.dumps(f) for f in failures[:40]))
    stub = json.dumps({"lessons": [{"text": "Thin cartons crush under medium grip; pick them with grip='soft'.",
                                    "product_class": "thin_carton", "family": "crush"}]})
    out = llm.chat(STRONG_MODEL, SYSTEM, user, temperature=0.2, max_tokens=600, stub=stub)
    try:
        data = json.loads(llm.extract_json(out["text"]))
        lessons = [l for l in data.get("lessons", []) if isinstance(l, dict) and l.get("text")][:3]
    except Exception:
        lessons = []
    return {"lessons": lessons, "cost_usd": out["cost_usd"], "model": out["model"]}

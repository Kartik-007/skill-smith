"""Coder agent: a cheap model writes `def pack(api):` for one order."""
from .. import llm
from ..config import CODER_MODEL, STRONG_MODEL
from ..skill_api import api_doc

SYSTEM = (
    "You write short, plain Python packing programs for a warehouse robot arm. "
    "Reply with exactly one ```python code block that defines def pack(api):. No explanations."
)
MODELS = {"cheap": CODER_MODEL, "strong": STRONG_MODEL}


def build_prompt(genome: dict, order_view: dict, lessons: list[dict], skills: list[dict],
                 previous_error: str | None = None) -> str:
    parts = [api_doc(genome["tools"])]
    parts.append(f"When unsure about speed, the packing team's default is {genome['defaults']['speed_mps']} m/s.")
    if genome["rules"]:
        parts.append("Rules from the packing team:\n" + "\n".join(f"- {r}" for r in genome["rules"]))
    if lessons:
        parts.append("Lessons from past failures:\n" + "\n".join(f"- {l['text']}" for l in lessons))
    if skills:
        parts.append("Proven skills for similar products:\n" + "\n".join(f"- {s['text']}" for s in skills))
    items = "\n".join(
        f"- id={it['id']}: {it['label']}: {it['description']}; approx size {it['approx_size_mm']} mm"
        + ("; must stay upright" if it["upright_required"] else "")
        for it in order_view["items"])
    parts.append(f"Order for {order_view['customer']}. Time budget {order_view['time_budget_s']} s.\nItems:\n{items}")
    if previous_error:
        parts.append(f"Your previous program failed with: {previous_error}\nFix it.")
    return "\n\n".join(parts)


STUB_CODE = """```python
def pack(api):
    slots = ['S1', 'S2', 'S3']
    for item, slot in zip(api.items(), slots):
        api.pick(item['id'], grip_N=8, speed_mps=0.35)
        api.place(item['id'], slot)
```"""


def write_program(genome: dict, prompt: str) -> dict:
    model = MODELS[genome["models"]["coder"]]
    # Haiku 5.5 spends part of max_tokens on hidden reasoning; at 1500 longer prompts came back truncated mid-program.
    out = llm.chat(model, SYSTEM, prompt, temperature=0.3, max_tokens=6000, stub=STUB_CODE)
    out["code"] = llm.extract_code(out["text"])
    return out

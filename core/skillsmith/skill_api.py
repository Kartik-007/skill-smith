"""The only interface the coder's program can call, plus the restricted sandbox that runs it.

The program runs once against a RecordingAPI. Tool answers (weigh, squeeze_test) come from the hidden truth,
bucketed and noisy, never the numbers. The result is an action list that the simulator executes later, one
queue step per item.
"""
import ast
import signal

import numpy as np

from . import catalog
from .executor import TOOL_COST_S
from .scene import SLOTS

GRIPS = ("soft", "medium", "firm", "max")
SPEEDS = ("slow", "normal", "fast")
# Approximate motion time per item at each speed (sim seconds), measured in calibration.
SPEED_TIME_S = {"slow": 11.8, "normal": 6.2, "fast": 4.1}


class PlanError(Exception):
    pass


def api_doc(tools: dict) -> str:
    lines = [
        "You control a Franka Panda arm that packs products into a box with 3 slots: S1, S2, S3.",
        "Write a Python function `def pack(api):` that packs every item in the order exactly once.",
        "Available calls:",
        "- api.items() -> list of dicts: {id, label, description, approx_size_mm [w, d, h], upright_required}",
        "- api.time_budget_s() -> the order's time budget in seconds (motion time + tool time)",
        f"- api.pick(id, grip='medium', speed='normal'): grasp the item. grip in {GRIPS} (stronger squeezes harder); "
        f"speed in {SPEEDS}. Approx motion time per item: slow {SPEED_TIME_S['slow']}s, normal "
        f"{SPEED_TIME_S['normal']}s, fast {SPEED_TIME_S['fast']}s.",
        "- api.place(id, slot): put the held item in a free slot ('S1', 'S2' or 'S3'). Call right after pick.",
    ]
    if tools.get("weigh"):
        lines.append(f"- api.weigh(id) -> 'light' | 'medium' | 'heavy' (noisy). Costs {TOOL_COST_S:.0f}s of budget.")
    if tools.get("squeeze_test"):
        lines.append(f"- api.squeeze_test(id) -> 'firm' | 'gives slightly' | 'soft' (noisy). How much the packaging "
                     f"gives under a light squeeze. Costs {TOOL_COST_S:.0f}s of budget.")
    lines += [
        "- api.report_gap(text): tell the engineers about information or a tool you are missing. Free.",
        "Items placed after the time budget runs out count as failures. No imports; plain Python only.",
    ]
    return "\n".join(lines)


class RecordingAPI:
    def __init__(self, order: dict, truth: dict, tools: dict):
        self._order, self._truth, self._tools = order, truth, tools
        self._items = {it["id"]: it for it in order["items"]}
        self.actions: list[dict] = []
        self.tool_calls: list[dict] = []
        self.gaps: list[str] = []
        self._pending: dict | None = None
        self._used_slots: set[str] = set()
        self._rng = {iid: np.random.default_rng(t["noise_seed"]) for iid, t in truth.items()}

    # ---- read ----
    def items(self) -> list[dict]:
        out = []
        for it in self._order["items"]:
            v = catalog.visible(it["product_id"])
            desc = v["description"]
            if self._truth[it["id"]]["condition"] == "wet":
                desc += " (cold from the fridge, condensation on the surface)"
            out.append({"id": it["id"], "label": v["label"], "description": desc,
                        "approx_size_mm": v["approx_size_mm"], "upright_required": v["upright_required"]})
        return out

    def time_budget_s(self) -> float:
        return float(self._order["time_budget_s"])

    def _check_id(self, iid) -> str:
        if iid not in self._items:
            raise PlanError(f"unknown item id {iid!r}")
        return iid

    # ---- tools ----
    def weigh(self, iid):
        if not self._tools.get("weigh"):
            raise PlanError("api.weigh is not enabled")
        iid = self._check_id(iid)
        m = self._truth[iid]["mass_kg"] * float(self._rng[iid].normal(1.0, 0.12))
        ans = "light" if m < 0.2 else "medium" if m < 0.5 else "heavy"
        self.tool_calls.append({"tool": "weigh", "item": iid, "answer": ans})
        return ans

    def squeeze_test(self, iid):
        if not self._tools.get("squeeze_test"):
            raise PlanError("api.squeeze_test is not enabled")
        iid = self._check_id(iid)
        c = self._truth[iid]["crush_limit_N"] * float(self._rng[iid].normal(1.0, 0.12))
        ans = "soft" if c < 11 else "gives slightly" if c < 30 else "firm"
        self.tool_calls.append({"tool": "squeeze_test", "item": iid, "answer": ans})
        return ans

    def report_gap(self, text) -> None:
        self.gaps.append(str(text)[:300])

    # ---- actions ----
    def pick(self, iid, grip="medium", speed="normal") -> None:
        iid = self._check_id(iid)
        if grip not in GRIPS:
            raise PlanError(f"grip must be one of {GRIPS}")
        if speed not in SPEEDS:
            raise PlanError(f"speed must be one of {SPEEDS}")
        if self._pending is not None:
            raise PlanError("place the held item before picking another")
        if any(a["item"] == iid for a in self.actions):
            raise PlanError(f"item {iid} was already packed")
        self._pending = {"item": iid, "grip": grip, "speed": speed}

    def place(self, iid, slot="S1", on_top_of=None, against_wall=None) -> None:
        iid = self._check_id(iid)
        if self._pending is None or self._pending["item"] != iid:
            raise PlanError(f"pick {iid} before placing it")
        if slot not in SLOTS:
            raise PlanError(f"slot must be one of {sorted(SLOTS)}")
        if slot in self._used_slots:
            raise PlanError(f"slot {slot} is already used")
        self._used_slots.add(slot)
        self.actions.append({**self._pending, "slot": slot})
        self._pending = None

    def tool_time_s(self) -> float:
        return TOOL_COST_S * len(self.tool_calls)


SAFE_BUILTINS = {n: __builtins__[n] if isinstance(__builtins__, dict) else getattr(__builtins__, n) for n in (
    "len", "range", "min", "max", "sorted", "enumerate", "zip", "list", "dict", "str", "int", "float", "abs",
    "round", "any", "all", "isinstance", "sum", "set", "tuple", "reversed", "print", "bool", "ValueError",
    "KeyError", "Exception", "map", "filter")}


def _check_ast(code: str) -> None:
    tree = ast.parse(code)
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.Global, ast.Nonlocal)):
            raise PlanError("imports are not allowed")
        if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
            raise PlanError("private attributes are not allowed")
        if isinstance(node, ast.Name) and node.id.startswith("__"):
            raise PlanError("dunder names are not allowed")
    if not any(isinstance(n, ast.FunctionDef) and n.name == "pack" for n in tree.body):
        raise PlanError("define def pack(api):")


class _PublicAPI:
    """Only public methods of the recording API are reachable from the program."""

    def __init__(self, rec: RecordingAPI):
        for name in ("items", "time_budget_s", "weigh", "squeeze_test", "report_gap", "pick", "place"):
            setattr(self, name, getattr(rec, name))


def run_program(code: str, rec: RecordingAPI, timeout_s: int = 5) -> str | None:
    """Execute the coder's program against the recording API. Returns an error string or None."""
    def _alarm(*_):
        raise TimeoutError("program took too long")

    try:
        _check_ast(code)
        env = {"__builtins__": SAFE_BUILTINS}
        old = signal.signal(signal.SIGALRM, _alarm)
        signal.alarm(timeout_s)
        try:
            exec(compile(code, "<pack>", "exec"), env)
            env["pack"](_PublicAPI(rec))
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, old)
        return None
    except Exception as e:  # the program is untrusted; any failure is a plan error
        return f"{type(e).__name__}: {e}"[:300]

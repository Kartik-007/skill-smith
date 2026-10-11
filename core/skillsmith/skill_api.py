"""The only interface the coder's program can call, plus the restricted sandbox that runs it.

The program runs once against a RecordingAPI. Tool answers (weigh, squeeze_test, surface_check) are noisy readings
of the hidden truth, never the truth itself. The result is an action list that the simulator executes later, one
queue step per item.
"""
import ast
import signal

import numpy as np

from . import catalog
from .control import GRIP_N_RANGE, SPEED_RANGE
from .executor import TOOL_COST_S
from .scene import SLOTS
from .truth import HINTS

TOOLS = ("weigh", "squeeze_test", "surface_check")
# Approximate motion time for one item (pick + carry + place), measured in calibration: about 1.6 + 1.6 / speed s,
# flattening out above ~0.8 m/s because the joints can't keep up.
SPEED_TIME_S = {0.1: 17.6, 0.15: 12.2, 0.25: 8.2, 0.35: 6.2, 0.5: 5.0, 0.7: 4.1, 1.0: 3.6}
WEIGH_NOISE = 0.12
SQUEEZE_NOISE = 0.25
SURFACE_ERROR = 0.10


class PlanError(Exception):
    pass


def item_time_s(speed_mps: float) -> float:
    xs = sorted(SPEED_TIME_S)
    return float(np.interp(speed_mps, xs, [SPEED_TIME_S[x] for x in xs]))


def api_doc(tools: dict) -> str:
    times = ", ".join(f"{v} m/s ~{t}s" for v, t in SPEED_TIME_S.items())
    lines = [
        "You control a Franka Panda arm that packs products into a box with 3 slots: S1, S2, S3.",
        "Write a Python function `def pack(api):` that packs every item in the order exactly once.",
        "Available calls:",
        "- api.items() -> list of dicts: {id, label, description, approx_size_mm [w, d, h], upright_required}",
        "- api.time_budget_s() -> the order's time budget in seconds (motion time + tool time)",
        f"- api.pick(id, grip_N, speed_mps): grasp the item and lift it. grip_N = squeeze force per finger in newtons, "
        f"{GRIP_N_RANGE[0]:g}-{GRIP_N_RANGE[1]:g}. Too little and the item slips out (heavier or slippery items need "
        f"more, and faster moves need more); too much and the packaging crushes. speed_mps = arm speed, "
        f"{SPEED_RANGE[0]:g}-{SPEED_RANGE[1]:g} m/s. Fast moves shake the item, so they need more grip and can spike "
        f"the squeeze on fragile packaging. Approx motion time per item: {times}.",
        "  Gripper datasheet: to hold an item of m kg you need roughly grip_N >= k * m / friction, with k ~6 at "
        "0.15 m/s, ~7 at 0.35 m/s, ~8 at 0.5 m/s, ~11 at 1.0 m/s. Friction of the fingertips on dry cardboard or "
        "plastic is ~0.35-0.5; damp surfaces are far more slippery. Squeezing much harder than needed doesn't make the "
        "hold safer and can crush packaging; about 1.3x the minimum is the usual choice. How hard packaging can be "
        "squeezed varies by product and condition.",
        "- api.place(id, slot): put the held item in a free slot ('S1', 'S2' or 'S3'). Call right after pick. "
        "The arm keeps items vertical, so they are always set down upright.",
    ]
    if tools.get("weigh"):
        lines.append(f"- api.weigh(id) -> mass in kg (float, about +/-{WEIGH_NOISE:.0%} noise). "
                     f"Costs {TOOL_COST_S:.0f}s of budget.")
    if tools.get("squeeze_test"):
        lines.append(f"- api.squeeze_test(id) -> float: about how many newtons per finger the packaging takes before "
                     f"it starts to give (about +/-{SQUEEZE_NOISE:.0%} noise). Costs {TOOL_COST_S:.0f}s of budget.")
    if tools.get("surface_check"):
        lines.append(f"- api.surface_check(id) -> 'dry' | 'damp' (wrong about {SURFACE_ERROR:.0%} of the time). "
                     f"Damp surfaces are slippery. Costs {TOOL_COST_S:.0f}s of budget.")
    lines += [
        "- api.report_gap(text): if you lack information you need to choose a grip or speed safely, say what is "
        "missing (one short sentence). Free; the engineers read these.",
        "The same product can arrive in a different condition from order to order (damp, dented, overfilled, "
        "half empty), which changes the safe grip.",
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
            t = self._truth[it["id"]]
            desc = v["description"]
            if t.get("hinted"):
                desc += f" ({HINTS[t['condition']]})"
            out.append({"id": it["id"], "label": v["label"], "description": desc,
                        "approx_size_mm": v["approx_size_mm"], "upright_required": v["upright_required"]})
        return out

    def time_budget_s(self) -> float:
        return float(self._order["time_budget_s"])

    def _check_id(self, iid) -> str:
        if iid not in self._items:
            raise PlanError(f"unknown item id {iid!r}")
        return iid

    # ---- tools: noisy numbers from the hidden truth, never the truth itself ----
    def _tool(self, name: str, iid) -> str:
        if not self._tools.get(name):
            raise PlanError(f"api.{name} is not enabled")
        return self._check_id(iid)

    def weigh(self, iid):
        iid = self._tool("weigh", iid)
        ans = round(self._truth[iid]["mass_kg"] * float(self._rng[iid].normal(1.0, WEIGH_NOISE)), 2)
        self.tool_calls.append({"tool": "weigh", "item": iid, "answer": ans})
        return ans

    def squeeze_test(self, iid):
        iid = self._tool("squeeze_test", iid)
        ans = round(self._truth[iid]["crush_limit_N"] * float(self._rng[iid].normal(1.0, SQUEEZE_NOISE)) * 2) / 2
        ans = max(0.5, ans)
        self.tool_calls.append({"tool": "squeeze_test", "item": iid, "answer": ans})
        return ans

    def surface_check(self, iid):
        iid = self._tool("surface_check", iid)
        damp = self._truth[iid]["condition"] == "wet"
        if float(self._rng[iid].random()) < SURFACE_ERROR:
            damp = not damp
        ans = "damp" if damp else "dry"
        self.tool_calls.append({"tool": "surface_check", "item": iid, "answer": ans})
        return ans

    def report_gap(self, text) -> None:
        self.gaps.append(str(text)[:300])

    # ---- actions ----
    def pick(self, iid, grip_N=None, speed_mps=None) -> None:
        iid = self._check_id(iid)
        try:
            grip_N, speed_mps = float(grip_N), float(speed_mps)
        except (TypeError, ValueError):
            raise PlanError("pick needs numbers: api.pick(id, grip_N, speed_mps)")
        if not GRIP_N_RANGE[0] <= grip_N <= GRIP_N_RANGE[1]:
            raise PlanError(f"grip_N must be {GRIP_N_RANGE[0]:g}-{GRIP_N_RANGE[1]:g}")
        if not SPEED_RANGE[0] <= speed_mps <= SPEED_RANGE[1]:
            raise PlanError(f"speed_mps must be {SPEED_RANGE[0]:g}-{SPEED_RANGE[1]:g}")
        if self._pending is not None:
            raise PlanError("place the held item before picking another")
        if any(a["item"] == iid for a in self.actions):
            raise PlanError(f"item {iid} was already packed")
        self._pending = {"item": iid, "grip_N": round(grip_N, 2), "speed_mps": round(speed_mps, 3)}

    def place(self, iid, slot="S1") -> None:
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
        for name in ("items", "time_budget_s", *TOOLS, "report_gap", "pick", "place"):
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

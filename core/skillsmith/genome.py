"""The harness genome (what the meta-agent may change) and the typed patch whitelist."""
import copy

V0 = {
    "rules": [],
    "tools": {"weigh": False, "squeeze_test": False},
    "retrieval": {"lessons_k": 0, "skills_k": 0, "min_score": 0.75},
    "defaults": {"carry_height_mm": 150, "speed": "normal"},
    "retry": {"max_retries": 0},
    "models": {"coder": "cheap", "critic": "strong", "meta": "strong"},
    "locked": {"max_grip_level": "max", "time_budget_s": 18, "workspace": "table", "referee_version": 1},
}

PATCH_OPS = {
    "add_rule": {"text": str},
    "remove_rule": {"index": int},
    "enable_tool": {"name": str},
    "disable_tool": {"name": str},
    "set_retrieval": {"lessons_k": int, "skills_k": int, "min_score": float},
    "set_default": {"carry_height_mm": int, "speed": str},
    "set_retry": {"max_retries": int},
    "set_model": {"role": str, "tier": str},
}
TOOLS = ("weigh", "squeeze_test")


class PatchRejected(Exception):
    pass


def validate(genome: dict, patch: dict) -> None:
    """Raises PatchRejected with a human-readable reason. Anything touching `locked` is rejected outright."""
    op = patch.get("op")
    args = patch.get("args", {}) or {}
    if op not in PATCH_OPS:
        if "locked" in str(patch) or any(k in str(patch) for k in genome["locked"]):
            raise PatchRejected("patch touches a locked guardrail")
        raise PatchRejected(f"unknown patch op {op!r}")
    if "locked" in str(args) or any(k in args for k in genome["locked"]):
        raise PatchRejected("patch touches a locked guardrail")
    allowed = PATCH_OPS[op]
    for k in args:
        if k not in allowed:
            raise PatchRejected(f"{op} does not take argument {k!r}")
    if op == "add_rule":
        text = str(args.get("text", ""))
        if not text or len(text) > 200:
            raise PatchRejected("rule text must be 1-200 characters")
        if len(genome["rules"]) >= 8:
            raise PatchRejected("already 8 rules")
    elif op == "remove_rule":
        if not (0 <= int(args.get("index", -1)) < len(genome["rules"])):
            raise PatchRejected("no rule at that index")
    elif op in ("enable_tool", "disable_tool"):
        if args.get("name") not in TOOLS:
            raise PatchRejected(f"tool must be one of {TOOLS}")
    elif op == "set_retrieval":
        if not args:
            raise PatchRejected("set_retrieval needs at least one argument")
        for k in ("lessons_k", "skills_k"):
            if k in args and not 0 <= int(args[k]) <= 5:
                raise PatchRejected(f"{k} must be 0-5")
        if "min_score" in args and not 0.0 <= float(args["min_score"]) <= 1.0:
            raise PatchRejected("min_score must be 0-1")
    elif op == "set_default":
        if "carry_height_mm" in args and not 80 <= int(args["carry_height_mm"]) <= 300:
            raise PatchRejected("carry_height_mm must be 80-300")
        if "speed" in args and args["speed"] not in ("slow", "normal", "fast"):
            raise PatchRejected("speed must be slow, normal or fast")
    elif op == "set_retry":
        if not 0 <= int(args.get("max_retries", -1)) <= 2:
            raise PatchRejected("max_retries must be 0-2")
    elif op == "set_model":
        if args.get("role") not in ("coder", "critic", "meta") or args.get("tier") not in ("cheap", "strong"):
            raise PatchRejected("set_model needs role in coder/critic/meta and tier in cheap/strong")


def apply(genome: dict, patch: dict) -> dict:
    validate(genome, patch)
    g = copy.deepcopy(genome)
    op, a = patch["op"], patch.get("args", {}) or {}
    if op == "add_rule":
        g["rules"].append(a["text"].strip())
    elif op == "remove_rule":
        g["rules"].pop(int(a["index"]))
    elif op == "enable_tool":
        g["tools"][a["name"]] = True
    elif op == "disable_tool":
        g["tools"][a["name"]] = False
    elif op == "set_retrieval":
        g["retrieval"].update({k: (float(v) if k == "min_score" else int(v)) for k, v in a.items()})
    elif op == "set_default":
        g["defaults"].update(a)
    elif op == "set_retry":
        g["retry"]["max_retries"] = int(a["max_retries"])
    elif op == "set_model":
        g["models"][a["role"]] = a["tier"]
    return g


def describe(patch: dict) -> str:
    a = patch.get("args", {}) or {}
    return f"{patch.get('op')} " + ", ".join(f"{k}={v!r}" for k, v in a.items())

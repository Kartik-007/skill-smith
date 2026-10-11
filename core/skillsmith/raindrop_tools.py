"""Read-only tools the meta-agent calls to investigate Raindrop itself, before it proposes its one patch.

What the Raindrop Query API does (checked against Atlas on skillsmith_v2, epoch 586de864):
- `properties` filters work server-side (harness_version / suite / epoch give exactly Atlas's run counts).
  Property values must be strings.
- `event_name` and `user_id` are ignored server-side (any value returns every event), so tools filter
  `event_name` client-side and pick generation events by their `verdict` property, which only they carry.
- The `signal` filter and the events' own signal lists agree with each other but miss some signals: on
  v0 training runs Raindrop has "crushed" on 11 of 16 events while Atlas has a crush in all 16. Atlas stays the
  source of truth, so counts also carry the Atlas figure (`atlas_mirror`).
- Signal properties (product, detail, the coder's gap text) are not returned by the Query API; per-item detail
  comes from the matching Atlas run (runs.raindrop_event_id), and gap text from Atlas.
Every tool returns small JSON, never raises, and falls back to Atlas (with "source": "atlas") when Raindrop fails.
"""
import json
import os

from . import db as dbm
from . import observe

TIMEOUT_MS = 15000
SIGNALS = ("crushed", "slipped", "collision", "tipped", "over_budget", "not_in_box", "packed_clean")
FAMILY_OF = {v: k for k, v in observe.FAMILY_SIGNAL.items()}
MAX_LIMIT = 5

_rq = None


def _client():
    global _rq
    key = os.environ.get("RAINDROP_QUERY_API_KEY")
    if not key:
        raise RuntimeError("no RAINDROP_QUERY_API_KEY")
    if _rq is None:
        from raindrop_query import RaindropQuery
        _rq = RaindropQuery(api_key=key, timeout_ms=TIMEOUT_MS)
    return _rq


def _props(version: int, suite: str) -> dict:
    return {"harness_version": str(version), "suite": suite, "epoch": observe.epoch()}


def _signal_names(e) -> set[str]:
    return {s["name"] if isinstance(s, dict) else s.name for s in (e.signals or [])}


def _pack_events(version: int, suite: str) -> list:
    data = _client().events.list(limit=100, properties=_props(version, suite)).data
    return [e for e in data if e.event_name == "pack_order"]


def _atlas_runs(version: int, suite: str) -> list[dict]:
    return list(dbm.db().runs.find({"version": version, "suite": suite, "status": "done"},
                                   {"items": 1, "order_id": 1, "plan_code": 1, "raindrop_event_id": 1, "gaps": 1}))


def _atlas_has(run: dict, signal: str) -> bool:
    if signal == "packed_clean":
        return any(i.get("ok") for i in run["items"])
    return any(i.get("family") == FAMILY_OF[signal] for i in run["items"])


def _check_signal(signal) -> str:
    if signal not in SIGNALS:
        raise ValueError(f"signal must be one of {SIGNALS}")
    return signal


def _items(run: dict | None) -> list[str]:
    if not run:
        return []
    return [f"{i.get('label', i['id'])}: {i.get('family') or 'ok'}" + (f" ({i['detail']})" if i.get("detail") else "")
            for i in run["items"]]


def _safe(fn):
    def wrapped(**kw):
        try:
            return fn(**kw)
        except (ValueError, TypeError) as e:
            return {"error": f"bad arguments: {e}"}
        except Exception as e:  # tools never break the generation
            return {"error": f"{type(e).__name__}: {str(e)[:200]}"}
    wrapped.__name__ = fn.__name__
    wrapped.__doc__ = fn.__doc__
    return wrapped


# ---------------------------------------------------------------- tools
@_safe
def count_signal(signal: str, version: int, suite: str = "T") -> dict:
    """How many of a version's order runs carry a signal."""
    signal, version = _check_signal(signal), int(version)
    runs = _atlas_runs(version, suite)
    atlas = {"orders": len(runs), "with_signal": sum(_atlas_has(r, signal) for r in runs)}
    try:
        evs = _pack_events(version, suite)
        return {"source": "raindrop", "signal": signal, "version": version, "suite": suite, "orders": len(evs),
                "with_signal": sum(signal in _signal_names(e) for e in evs), "atlas_mirror": atlas}
    except Exception as e:
        return {"source": "atlas", "signal": signal, "version": version, "suite": suite, **atlas,
                "note": f"raindrop unavailable ({type(e).__name__})"}


@_safe
def compare_versions(signal: str, version_a: int, version_b: int, suite: str = "T") -> dict:
    """The same signal for two versions, with rates."""
    out = {}
    for key, v in (("a", version_a), ("b", version_b)):
        c = count_signal(signal=signal, version=v, suite=suite)
        if "error" in c:
            return c
        c["rate"] = round(c["with_signal"] / c["orders"], 2) if c["orders"] else None
        out[key] = c
    return {"signal": signal, "suite": suite, **out}


@_safe
def find_events(signal: str, version: int, suite: str = "T", limit: int = 3) -> dict:
    """Up to `limit` order runs of a version that carry the signal: event id, order, the items' verdicts
    (from the matching Atlas run) and the start of the coder's program."""
    signal, version, limit = _check_signal(signal), int(version), min(int(limit), MAX_LIMIT)
    by_event = {r.get("raindrop_event_id"): r for r in _atlas_runs(version, suite)}
    try:
        hits = [e for e in _pack_events(version, suite) if signal in _signal_names(e)][:limit]
        return {"source": "raindrop", "signal": signal, "version": version, "events": [
            {"event_id": e.id, "order_id": (e.properties or {}).get("order_id"),
             "items": _items(by_event.get(e.id)), "program": (e.assistant_output or "")[:1500]} for e in hits]}
    except Exception as e:
        hits = [r for r in by_event.values() if _atlas_has(r, signal)][:limit]
        return {"source": "atlas", "note": f"raindrop unavailable ({type(e).__name__})", "signal": signal,
                "version": version, "events": [
                    {"event_id": r.get("raindrop_event_id"), "order_id": r["order_id"], "items": _items(r),
                     "program": (r.get("plan_code") or "")[:1500]} for r in hits]}


@_safe
def get_event(event_id: str) -> dict:
    """One order run: its program, its Raindrop signals and the items' verdicts."""
    event_id = str(event_id)[:64]
    run = dbm.db().runs.find_one({"raindrop_event_id": event_id}, {"items": 1, "order_id": 1, "plan_code": 1})
    try:
        e = _client().events.get(id=event_id).data
        return {"source": "raindrop", "event_id": e.id, "order_id": (e.properties or {}).get("order_id"),
                "signals": sorted(_signal_names(e)), "items": _items(run), "program": (e.assistant_output or "")[:2500]}
    except Exception as ex:
        if not run:
            return {"error": f"no such event ({type(ex).__name__})"}
        return {"source": "atlas", "note": f"raindrop unavailable ({type(ex).__name__})", "event_id": event_id,
                "order_id": run["order_id"], "items": _items(run), "program": (run.get("plan_code") or "")[:2500]}


@_safe
def list_gaps(version: int, limit: int = 8) -> dict:
    """Distinct capability gaps the coder reported on a version's training runs. The text lives in Atlas: the
    Query API doesn't return signal comments."""
    version, limit = int(version), min(int(limit), 8)
    gaps = dbm.db().runs.distinct("gaps", {"version": version, "suite": "T"})
    return {"source": "atlas", "version": version, "gaps": [g[:200] for g in gaps[:limit]], "total_distinct": len(gaps)}


@_safe
def gate_history() -> dict:
    """Every generation so far: patch, verdict, reason, scores (the harness_patch events)."""
    try:
        data = [e for verdict in ("kept", "rolled_back", "rejected")
                for e in _client().events.list(limit=50, properties={"epoch": observe.epoch(), "verdict": verdict}).data]
        rows = sorted((e for e in data if e.event_name == "harness_patch"),
                      key=lambda e: int((e.properties or {}).get("harness_version", 0)))
        return {"source": "raindrop", "generations": [
            {"version": int(p.get("harness_version", 0)), "patch": (e.user_input or "").split("\n")[0][:160],
             "result": (e.assistant_output or "")[:200], "T": p.get("T"), "H": p.get("H")}
            for e in rows for p in [e.properties or {}]]}
    except Exception as ex:
        rows = dbm.db().harness_versions.find({"status": {"$ne": "evaluating"}}, {"genome": 0}).sort("version", 1)
        return {"source": "atlas", "note": f"raindrop unavailable ({type(ex).__name__})", "generations": [
            {"version": v["version"], "patch": v.get("patch_text"),
             "result": f"{v.get('verdict')}: {v.get('verdict_reason', '')}"[:200],
             "T": (v.get("scores") or {}).get("T"), "H": (v.get("scores") or {}).get("H")} for v in rows]}


TOOLS = {f.__name__: f for f in (count_signal, compare_versions, find_events, get_event, list_gaps, gate_history)}

_SIG = {"type": "string", "enum": list(SIGNALS)}
_VER = {"type": "integer", "minimum": 0}
_SUITE = {"type": "string", "enum": ["T", "H"], "description": "T = training orders, H = held-out"}
SCHEMAS = [
    {"name": "count_signal", "description": count_signal.__doc__,
     "parameters": {"type": "object", "properties": {"signal": _SIG, "version": _VER, "suite": _SUITE},
                    "required": ["signal", "version"]}},
    {"name": "compare_versions", "description": compare_versions.__doc__,
     "parameters": {"type": "object", "properties": {"signal": _SIG, "version_a": _VER, "version_b": _VER,
                                                     "suite": _SUITE},
                    "required": ["signal", "version_a", "version_b"]}},
    {"name": "find_events", "description": find_events.__doc__,
     "parameters": {"type": "object", "properties": {"signal": _SIG, "version": _VER, "suite": _SUITE,
                                                     "limit": {"type": "integer", "minimum": 1, "maximum": MAX_LIMIT}},
                    "required": ["signal", "version"]}},
    {"name": "get_event", "description": get_event.__doc__,
     "parameters": {"type": "object", "properties": {"event_id": {"type": "string"}}, "required": ["event_id"]}},
    {"name": "list_gaps", "description": list_gaps.__doc__,
     "parameters": {"type": "object", "properties": {"version": _VER, "limit": {"type": "integer", "maximum": 8}},
                    "required": ["version"]}},
    {"name": "gate_history", "description": gate_history.__doc__, "parameters": {"type": "object", "properties": {}}},
    {"name": "query_atlas",
     "description": "Read-only find on an Atlas collection of the harness database (max 10 documents).",
     "parameters": {"type": "object", "properties": {"database": {"type": "string"}, "collection": {"type": "string"},
                                                     "filter": {"type": "object"}},
                    "required": ["database", "collection"]}},
]


def run(name: str, args: dict, query_atlas) -> dict:
    """Execute one tool call from the model. query_atlas is evolve's tripwire-logging wrapper."""
    if name == "query_atlas":
        return query_atlas({"database": args.get("database", ""), "collection": args.get("collection", ""),
                            "filter": args.get("filter") or {}})
    if name not in TOOLS:
        return {"error": f"unknown tool {name!r}"}
    allowed = SCHEMAS[[s["name"] for s in SCHEMAS].index(name)]["parameters"]["properties"]
    return TOOLS[name](**{k: v for k, v in (args or {}).items() if k in allowed})


def summarize(name: str, args: dict, result) -> str:
    """One line for the feed: what was asked and the gist of the answer."""
    a = ", ".join(f"{v}" for v in (args or {}).values())
    if isinstance(result, dict) and "error" in result:
        return f"{name}({a}) → error: {result['error'][:80]}"
    if name == "count_signal":
        return f"{name}({a}) → {result['with_signal']} of {result['orders']} orders [{result['source']}]"
    if name == "compare_versions":
        return (f"{name}({a}) → v{args.get('version_a')} {result['a']['with_signal']}/{result['a']['orders']}, "
                f"v{args.get('version_b')} {result['b']['with_signal']}/{result['b']['orders']}")
    if name == "find_events":
        return f"{name}({a}) → {len(result['events'])} events [{result['source']}]"
    if name == "gate_history":
        return f"{name}() → {len(result['generations'])} generations [{result['source']}]"
    if name == "list_gaps":
        return f"{name}({a}) → {len(result['gaps'])} gaps [atlas]"
    return f"{name}({a}) → {json.dumps(result, default=str)[:90]}"

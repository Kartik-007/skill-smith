"""Raindrop instrumentation. Physics facts from the referee become Raindrop signals; the coder's own
capability-gap reports become feedback signals. Atlas stays the source of truth for scores and gate decisions."""
import os
import re
import uuid

from .config import env

_ready = False
FAMILY_SIGNAL = {"crush": "crushed", "slip": "slipped", "tip": "tipped", "collision": "collision",
                 "over_budget": "over_budget", "in_box": "not_in_box", "ordering": "crushed_by_stack"}


def _rd():
    global _ready
    import raindrop.analytics as raindrop
    if not _ready:
        raindrop.init(api_key=env("RAINDROP_WRITE_KEY"), tracing_enabled=False, auto_instrument=False)
        raindrop.set_debug_logs(os.environ.get("RAINDROP_DEBUG", "0") == "1")
        _ready = True
    return raindrop


def user_slug(customer: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", customer.lower()).strip("-") or "customer"


_epoch: str | None = None


def epoch() -> str:
    """Id of the current seeded dataset. Run ids repeat after a reset, so event ids and filters include this."""
    global _epoch
    if _epoch is None:
        from . import db as dbm
        doc = dbm.db().meta.find_one({"_id": "epoch"})
        if doc is None:
            dbm.db().meta.update_one({"_id": "epoch"}, {"$setOnInsert": {"value": uuid.uuid4().hex[:8]}}, upsert=True)
            doc = dbm.db().meta.find_one({"_id": "epoch"})
        _epoch = doc["value"]
    return _epoch


def event_id_for(order_run_id: str) -> str:
    """Deterministic, so a replayed verify step re-sends the same event instead of a new one."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"skillsmith/{epoch()}/{order_run_id}"))


def report_run(run: dict, genome_summary: str, flush_now: bool = True) -> str | None:
    """One Raindrop AI event per order run, plus one signal per referee verdict and per capability gap."""
    if os.environ.get("SKILLSMITH_NO_RAINDROP") == "1":
        return None
    try:
        rd = _rd()
        eid = event_id_for(run["_id"])
        items = "; ".join(f"{it['id']} {it['label']}" for it in run["items"])
        rd.track_ai(
            user_id=user_slug(run["customer"]), event="pack_order", event_id=eid, model=run.get("model", ""),
            input=f"Order {run['order_id']} for {run['customer']}: {items}\nHarness: {genome_summary}",
            output=run.get("plan_code", "")[:4000], convo_id=run["batch_id"],
            properties={"harness_version": run["version"], "suite": run["suite"], "order_id": run["order_id"],
                        "epoch": epoch(),
                        "repeat": run["repeat"], "damage_free": run["damage_free"], "n_items": run["n_items"],
                        "cycle_s": run["cycle_s"], "cost_usd": run["cost_usd"]},
        )
        for it in run["items"]:
            fam = it.get("family")
            props = {"harness_version": run["version"], "product": it["product_id"], "suite": run["suite"]}
            if fam:
                rd.track_signal(event_id=eid, name=FAMILY_SIGNAL.get(fam, fam), sentiment="NEGATIVE",
                                properties={**props, "detail": it.get("detail", "")[:200]})
            else:
                rd.track_signal(event_id=eid, name="packed_clean", sentiment="POSITIVE", properties=props)
        for gap in run.get("gaps", []):
            rd.track_signal(event_id=eid, name="capability_gap", signal_type="feedback", comment=gap,
                            sentiment="NEGATIVE", properties={"harness_version": run["version"]})
        if flush_now:
            rd.flush()  # workers can be terminated between batches; don't leave events in the buffer
        return eid
    except Exception as e:  # observability must never break the night shift
        print(f"[raindrop] skipped: {e}")
        return None


def report_generation(v: dict) -> None:
    """One Raindrop event per harness generation: the meta-agent's patch (input) and the gate verdict (output)."""
    if os.environ.get("SKILLSMITH_NO_RAINDROP") == "1":
        return
    try:
        rd = _rd()
        eid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"skillsmith/{epoch()}/generation/{v['version']}"))
        s = v.get("scores", {}) or {}
        rd.track_ai(user_id="meta-agent", event="harness_patch", event_id=eid, model=(v.get("meta") or {}).get("model", ""),
                    input=f"{v.get('patch_text')}\nRationale: {v.get('rationale', '')}",
                    output=f"{v.get('verdict')}: {v.get('verdict_reason', '')}", convo_id="evolution",
                    properties={"harness_version": v["version"], "parent": v.get("parent") or 0, "epoch": epoch(),
                                "verdict": v.get("verdict") or "", "H": s.get("H") or 0.0, "T": s.get("T") or 0.0})
        rd.track_signal(event_id=eid, name=f"gate_{v.get('verdict')}",
                        sentiment="POSITIVE" if v.get("verdict") == "kept" else "NEGATIVE",
                        properties={"harness_version": v["version"]})
        rd.flush()
    except Exception as e:
        print(f"[raindrop] skipped: {e}")


_rq = None
SIGNAL_LABELS = {"crushed": "Crushed", "slipped": "Slipped", "tipped": "Tipped", "collision": "Collision",
                 "over_budget": "Over budget", "not_in_box": "Not in box", "packed_clean": "Packed clean",
                 "capability_gap": "Capability gap", "crushed_by_stack": "Crushed by stack"}


def query_signals(version: int, suite: str) -> dict | None:
    """Read back from Raindrop: how many of this version's order events carry each signal.
    Returns None when no Query API key is configured or Raindrop can't be reached."""
    global _rq
    key = os.environ.get("RAINDROP_QUERY_API_KEY")
    if not key:
        return None
    try:
        from raindrop_query import RaindropQuery
        if _rq is None:
            _rq = RaindropQuery(api_key=key, timeout_ms=15000)
        ids = {s.name: s.id for s in _rq.signals.list(limit=100).data}
        props = {"harness_version": str(version), "suite": suite, "epoch": epoch()}
        total = _rq.events.count(event_name="pack_order", properties=props).data.total
        counts = {}
        for name, label in SIGNAL_LABELS.items():
            if label in ids:
                counts[name] = _rq.events.count(event_name="pack_order", signal=ids[label], properties=props).data.total
        return {"source": "raindrop query api", "order_events": total, "orders_with_signal": counts}
    except Exception as e:
        print(f"[raindrop query] falling back to Atlas: {e}")
        return None


def flush() -> None:
    if _ready:
        import raindrop.analytics as raindrop
        raindrop.flush()

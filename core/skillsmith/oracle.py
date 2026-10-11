"""Oracle (no LLM): every grip x speed per item. Confirms each order is solvable and that the best *constant*
plan is clearly below 100%, so there is something for the harness to learn."""
import itertools
from multiprocessing import Pool

from .pipeline import execute
from .skill_api import GRIPS, SPEEDS
from .suites import build_suites, truth_for

COMBOS = list(itertools.product(GRIPS, SPEEDS))


def _run(args):
    order, truth, actions = args
    res = execute(order, truth, {"actions": actions, "tool_time_s": 0.0}, 150)
    return order["_id"], actions, res


def main(processes: int = 8) -> dict:
    orders, truth_docs = build_suites()
    orders = [o for o in orders if o["suite"] in ("T", "H", "F")]
    jobs = []
    for o in orders:
        truth = truth_for(o, truth_docs)
        for grip, speed in COMBOS:
            acts = [{"item": it["id"], "grip": grip, "speed": speed, "slot": f"S{k + 1}"} for k, it in enumerate(o["items"])]
            jobs.append((o, truth, acts))
    with Pool(processes) as pool:
        results = pool.map(_run, jobs)
    # per item: which combos succeed
    per_item, const = {}, {}
    for oid, acts, res in results:
        g, s = acts[0]["grip"], acts[0]["speed"]
        const.setdefault((g, s), [0, 0])
        const[(g, s)][0] += res["damage_free"]
        const[(g, s)][1] += res["n_items"]
        for v in res["items"]:
            per_item.setdefault((oid, v["product_id"]), {})[(g, s)] = v["family"] or "ok"
    solvable = sum(any(f == "ok" for f in d.values()) for d in per_item.values())
    print(f"items solvable by some grip x speed: {solvable}/{len(per_item)}")
    for (g, s), (ok, n) in sorted(const.items(), key=lambda kv: -kv[1][0]):
        print(f"constant plan grip={g:6s} speed={s:6s}: {ok}/{n} = {100 * ok / n:.0f}%")
    for (oid, pid), d in sorted(per_item.items()):
        oks = [f"{g[0]}{s[0]}" for (g, s), f in d.items() if f == "ok"]
        fails = sorted({f for f in d.values() if f != "ok"})
        print(f"{oid} {pid:20s} ok: {' '.join(oks):40s} fails: {fails}")
    return {"solvable": solvable, "n": len(per_item), "constant": {f"{g}/{s}": v for (g, s), v in const.items()}}


if __name__ == "__main__":
    main()

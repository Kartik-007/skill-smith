"""Oracle (no LLM): a grid of constant grip_N x speed plans per order. It answers three questions:
1. is every item solvable by *some* grip and speed (ignoring the budget)?
2. is every order solvable within its budget, using each item's fastest safe setting? (verified by a real run)
3. how good is the best one-size-fits-all plan? It must be well below 100%, so there is something to learn.
"""
import itertools
from multiprocessing import Pool

from .pipeline import execute
from .suites import build_suites, truth_for

GRIPS_N = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 9, 10, 12, 14, 17, 20, 25, 32, 45]
SPEEDS = [0.15, 0.25, 0.35, 0.5, 0.7, 1.0]
COMBOS = list(itertools.product(GRIPS_N, SPEEDS))
START_S = 0.2  # the sim settles for 0.2 s before the first move


def _slots(order: dict) -> list[str]:
    return [f"S{k + 1}" for k in range(len(order["items"]))]


def _run(args):
    order, truth, actions, budget = args
    res = execute({**order, "time_budget_s": budget}, truth, {"actions": actions, "tool_time_s": 0.0}, 150)
    return order["_id"], actions, res


def main(processes: int = 8, suites=("T", "H", "F")) -> dict:
    orders, truth_docs = build_suites()
    orders = [o for o in orders if o["suite"] in suites]
    jobs = []
    for o in orders:
        truth = truth_for(o, truth_docs)
        for g, s in COMBOS:
            acts = [{"item": it["id"], "grip_N": g, "speed_mps": s, "slot": slot}
                    for it, slot in zip(o["items"], _slots(o))]
            jobs.append((o, truth, acts, 1e9))
    with Pool(processes) as pool:
        results = pool.map(_run, jobs, chunksize=4)
    by_order = {o["_id"]: o for o in orders}
    per_item: dict = {}  # (order, item) -> {(g, s): (family, item_time)}
    const: dict = {}
    for oid, acts, res in results:
        g, s = acts[0]["grip_N"], acts[0]["speed_mps"]
        budget = by_order[oid]["time_budget_s"]
        prev = START_S
        ok = 0
        for v in res["items"]:
            fam = v["family"] or "ok"
            per_item.setdefault((oid, v["id"]), {})[(g, s)] = (fam, v["elapsed_s"] - prev, v["product_id"])
            if fam == "ok" and v["elapsed_s"] <= budget:
                ok += 1
            prev = v["elapsed_s"]
        c = const.setdefault((g, s), [0, 0])
        c[0] += ok
        c[1] += len(res["items"])
    # 1. items
    solvable = {k: [(gs, t) for gs, (f, t, _) in d.items() if f == "ok"] for k, d in per_item.items()}
    n_solv = sum(bool(v) for v in solvable.values())
    print(f"items solvable by some grip x speed: {n_solv}/{len(per_item)}")
    # 2. orders: fastest safe setting per item, then a real run with the budget
    verify = []
    for oid, o in by_order.items():
        acts, est = [], START_S
        for it, slot in zip(o["items"], _slots(o)):
            opts = solvable[(oid, it["id"])]
            if not opts:
                break
            # fastest safe setting, preferring a grip in the middle of the safe range at that speed
            (g, s), t = min(opts, key=lambda x: (round(x[1], 1), -x[0][1]))
            safe = sorted(gg for (gg, ss), _ in opts if ss == s)
            g = safe[len(safe) // 2]
            acts.append({"item": it["id"], "grip_N": g, "speed_mps": s, "slot": slot})
            est += t
        if len(acts) == len(o["items"]):
            verify.append((o, truth_for(o, truth_docs), acts, o["time_budget_s"]))
    with Pool(processes) as pool:
        checked = pool.map(_run, verify)
    n_orders = 0
    for oid, acts, res in checked:
        ok = res["damage_free"] == res["n_items"]
        n_orders += ok
        print(f"order {oid}: best-per-item plan {res['damage_free']}/{res['n_items']} in {res['cycle_s']}s "
              f"(budget {by_order[oid]['time_budget_s']}s)" + ("" if ok else "  <-- not solved: "
              + ", ".join(f"{v['id']} {v['family']}" for v in res["items"] if not v["ok"])))
    print(f"orders solvable within budget: {n_orders}/{len(by_order)}")
    # 3. constant plans
    ranked = sorted(const.items(), key=lambda kv: -kv[1][0])
    for (g, s), (ok, n) in ranked[:8]:
        print(f"constant plan grip={g:>4} N speed={s:4.2f} m/s: {ok}/{n} = {100 * ok / n:.0f}%")
    for (oid, iid), d in sorted(per_item.items()):
        pid = next(iter(d.values()))[2]
        opts = solvable[(oid, iid)]
        cond = truth_for(by_order[oid], truth_docs)[iid]["condition"]
        if opts:
            gs = sorted({g for (g, _), _ in opts})
            fast = max(s for (_, s), _ in opts)
            line = f"grip {gs[0]}-{gs[-1]} N, fastest {fast} m/s"
        else:
            line = "UNSOLVABLE " + str(sorted({f for f, _, _ in d.values()}))
        print(f"  {oid} {iid} {pid:20s} {cond:16s} {line}")
    best = ranked[0]
    return {"items_solvable": n_solv, "items": len(per_item), "orders_solvable": n_orders, "orders": len(by_order),
            "best_constant": {"grip_N": best[0][0], "speed_mps": best[0][1], "pct": round(100 * best[1][0] / best[1][1], 1)}}


if __name__ == "__main__":
    main()

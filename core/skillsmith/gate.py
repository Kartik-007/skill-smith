"""The gate: paired comparison per item instance, bootstrap over orders, plus guardrails."""
import numpy as np

FAMILIES = ["crush", "slip", "collision", "tip", "in_box", "over_budget"]


def summarize(runs: list[dict]) -> dict:
    """runs of one version on one suite -> per-item mean success, per-order means, family counts per pass."""
    runs = [r for r in runs if r.get("status") == "done"]
    per_item: dict = {}
    fam = {f: 0 for f in FAMILIES}
    for r in runs:
        for it in r["items"]:
            per_item.setdefault((r["order_id"], it["id"]), []).append(1.0 if it["ok"] else 0.0)
            if it.get("family"):
                fam[it["family"]] = fam.get(it["family"], 0) + 1
    repeats = max(1.0, len(runs) / max(1, len({r["order_id"] for r in runs})))
    n_items = len(per_item)
    rate = {k: float(np.mean(v)) for k, v in per_item.items()}
    return {
        "rate": rate,
        "pct": round(100 * float(np.mean(list(rate.values()))), 1) if rate else 0.0,
        "family_per_pass": {f: round(c / repeats, 2) for f, c in fam.items()},
        "cycle_s": round(float(np.mean([r["cycle_s"] for r in runs])), 2) if runs else 0.0,
        "cost_usd": round(float(np.mean([r["cost_usd"] for r in runs])), 5) if runs else 0.0,
        "n_items": n_items,
        "n_runs": len(runs),
    }


def p_better(cand: dict, inc: dict, n_boot: int = 1000, seed: int = 0) -> tuple[float, float]:
    """Paired over common item instances; bootstrap resamples orders. Returns (P(cand > inc), mean delta pts)."""
    keys = sorted(set(cand["rate"]) & set(inc["rate"]))
    if not keys:
        return 0.0, 0.0
    orders = sorted({k[0] for k in keys})
    diff_by_order = {o: [cand["rate"][k] - inc["rate"][k] for k in keys if k[0] == o] for o in orders}
    delta = 100 * float(np.mean([d for ds in diff_by_order.values() for d in ds]))
    rng = np.random.default_rng(seed)
    wins = 0
    for _ in range(n_boot):
        sample = rng.choice(orders, size=len(orders), replace=True)
        ds = [d for o in sample for d in diff_by_order[o]]
        if np.mean(ds) > 0:
            wins += 1
    return wins / n_boot, round(delta, 1)


def decide(cand_T: dict, inc_T: dict, cand_H: dict, inc_H: dict) -> dict:
    pT, dT = p_better(cand_T, inc_T)
    _, dH = p_better(cand_H, inc_H)
    reasons = []
    worst_family, worst_regress = None, 0.0
    for f in FAMILIES:
        r = (cand_T["family_per_pass"].get(f, 0) + cand_H["family_per_pass"].get(f, 0)) - \
            (inc_T["family_per_pass"].get(f, 0) + inc_H["family_per_pass"].get(f, 0))
        if r > worst_regress:
            worst_family, worst_regress = f, r
    cycle_ratio = cand_T["cycle_s"] / max(inc_T["cycle_s"], 1e-6)
    cost_ratio = cand_T["cost_usd"] / max(inc_T["cost_usd"], 1e-9)
    verdict = "kept"
    if cost_ratio > 2.0:
        verdict = "rejected"
        reasons.append(f"cost guard: {cost_ratio:.1f}x the cost per order")
    if cycle_ratio > 1.2:
        verdict = "rejected"
        reasons.append(f"cycle time +{100 * (cycle_ratio - 1):.0f}%")
    if verdict == "kept":
        if worst_regress > 1.0:
            verdict = "rolled_back"
            reasons.append(f"'{worst_family}' failures up by {worst_regress:.1f} items")
        if dH < 0:
            verdict = "rolled_back"
            reasons.append(f"held-out got worse ({dH:+.1f} pts)")
        if not (dT > 0 and pT >= 0.8):
            verdict = "rolled_back"
            reasons.append(f"no clear gain on train ({dT:+.1f} pts, P(better)={pT:.2f})")
    if verdict == "kept":
        reasons.append(f"train {dT:+.1f} pts (P(better)={pT:.2f}), held-out {dH:+.1f} pts")
    return {"verdict": verdict, "reason": "; ".join(reasons), "p_better": pT, "delta_T": dT, "delta_H": dH,
            "cycle_ratio": round(cycle_ratio, 2), "cost_ratio": round(cost_ratio, 2)}

"""Fixed evaluation suites, written before the first run: train T, held-out H, final exam F, plus the story order.

Held-out products never appear in training orders.
"""
import numpy as np

from . import catalog
from .truth import make_truth

TIME_BUDGET_S = 24
SUITE_SIZES = {"T": 8, "H": 6, "F": 3}
STORY_CUSTOMER = "Dev Ittycheria"


def _products(split: str) -> list[str]:
    return [p.id for p in catalog.PRODUCTS if p.split == split]


def _order(order_id: str, suite: str, customer: str, products: list[str], seed: int) -> dict:
    return {
        "_id": order_id, "suite": suite, "customer": customer, "seed": seed, "time_budget_s": TIME_BUDGET_S,
        "items": [{"id": f"i{k}", "product_id": p} for k, p in enumerate(products)],
    }


def build_suites() -> tuple[list[dict], list[dict]]:
    """Returns (orders, truth_docs)."""
    rng = np.random.default_rng(20261011)
    orders = []
    pools = {"T": _products("train"), "H": _products("heldout"), "F": _products("final")}
    for suite, n in SUITE_SIZES.items():
        for k in range(n):
            pool = pools[suite]
            if suite == "H":
                # every held-out order has at least two held-out products and may borrow one training product
                picks = list(rng.choice(pool, size=2, replace=False)) + [str(rng.choice(pools["T"] + pool))]
                while len(set(picks)) < 3:
                    picks[2] = str(rng.choice(pools["T"] + pool))
            elif suite == "F":
                picks = list(pool) + [str(rng.choice(pools["H"]))]
            else:
                picks = list(rng.choice(pool, size=3, replace=False))
            rng.shuffle(picks)
            orders.append(_order(f"{suite}{k + 1:02d}", suite, STORY_CUSTOMER, [str(p) for p in picks],
                                 int(rng.integers(0, 2**31))))
    orders.append(_order("STORY", "story", STORY_CUSTOMER, ["cupcakes", "nesquik", "cereal"], 7))
    truth = [make_truth(o["_id"], o["seed"], it["id"], it["product_id"]) for o in orders for it in o["items"]]
    return orders, truth


def truth_for(order: dict, truth_docs: list[dict]) -> dict:
    return {t["item_id"]: t for t in truth_docs if t["order_id"] == order["_id"]}

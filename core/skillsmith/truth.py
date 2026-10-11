"""Hidden truth per order item: mass, friction, crush limit, condition, centre-of-mass offset, noise seed.

Generated deterministically from the order seed, written to the truth database, and read back only by the
referee/executor path. Agents never see these numbers.

v2: every item also gets a hidden *condition* that moves its safe grip window away from its product class, so the
same product needs different handling in different orders. Memory of "what worked for cupcakes" is therefore not
enough on its own: the coder has to notice the condition (sometimes from a hint in the description, reliably from
the noisy tools) and adjust.
"""
import hashlib

import numpy as np

from . import catalog

# Probability of each condition per material class (the rest is "dry").
CONDITIONS = {
    "thin_carton": {"damaged": 0.35, "overfilled": 0.15, "half_empty": 0.10},
    "candy_box": {"damaged": 0.30, "overfilled": 0.15, "half_empty": 0.10, "shifted_contents": 0.10},
    "dense_box": {"overfilled": 0.30, "half_empty": 0.25, "damaged": 0.15},
    "canister": {"wet": 0.45, "half_empty": 0.15, "overfilled": 0.10},
    "plastic_bottle": {"wet": 0.45, "half_empty": 0.15},
}
# How often the description gives the condition away. The tools are the reliable way to find out.
HINT_P = {"wet": 0.5, "damaged": 0.3, "overfilled": 0.3, "half_empty": 0.3, "shifted_contents": 0.3}
HINTS = {
    "wet": "cold from the fridge, condensation on the surface",
    "damaged": "one corner of the box is dented",
    "overfilled": "the packaging bulges, packed very full",
    "half_empty": "it feels partly empty",
    "shifted_contents": "the contents have slid to one end",
}
WET_FRICTION = 0.4
DAMAGED_CRUSH = 0.6
OVERFILLED_MASS = 1.3
HALF_EMPTY_MASS = 0.5


def _rng(*parts) -> np.random.Generator:
    h = hashlib.sha1(":".join(map(str, parts)).encode()).digest()
    return np.random.default_rng(int.from_bytes(h[:8], "little"))


def _condition(cls: str, upright: bool, r: float) -> str:
    acc = 0.0
    for cond, p in CONDITIONS[cls].items():
        if cond == "shifted_contents" and not upright:
            continue
        acc += p
        if r < acc:
            return cond
    return "dry"


def make_truth(order_id: str, seed: int, item_id: str, product_id: str) -> dict:
    p = catalog.BY_ID[product_id]
    mat = catalog.MATERIALS[p.cls]
    rng = _rng(order_id, seed, item_id)
    condition = _condition(p.cls, p.upright_required, float(rng.random()))
    friction = mat["friction"] * float(rng.uniform(0.95, 1.05))
    mass = p.mass_kg * float(rng.uniform(0.95, 1.05))
    lo, hi = mat["strength_N_per_kg"]
    crush = float(rng.uniform(lo, hi)) * p.mass_kg
    com = [0.0, 0.0, 0.0]
    if condition == "wet":
        friction *= WET_FRICTION
    elif condition == "damaged":
        crush *= DAMAGED_CRUSH
    elif condition == "overfilled":
        mass *= OVERFILLED_MASS
    elif condition == "half_empty":
        mass *= HALF_EMPTY_MASS
        com = [0.0, 0.0, -0.03]  # what's left settles to the bottom
    elif condition == "shifted_contents":
        com = [0.0, float(rng.choice([-1, 1]) * 0.05), -0.05]
    hinted = condition != "dry" and float(rng.random()) < HINT_P[condition]
    return {
        "order_id": order_id,
        "item_id": item_id,
        "product_id": product_id,
        "mass_kg": round(mass, 3),
        "friction": round(friction, 3),
        "crush_limit_N": round(crush, 1),
        "condition": condition,
        "hinted": hinted,
        "com_offset_m": com,
        "noise_seed": int(rng.integers(0, 2**31)),
    }

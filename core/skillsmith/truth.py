"""Hidden truth per order item: mass, friction, crush limit, condition, centre-of-mass offset, noise seed.

Generated deterministically from the order seed, written to the truth database, and read back only by the
referee/executor path. Agents never see these numbers.
"""
import hashlib

import numpy as np

from . import catalog


def _rng(*parts) -> np.random.Generator:
    h = hashlib.sha1(":".join(map(str, parts)).encode()).digest()
    return np.random.default_rng(int.from_bytes(h[:8], "little"))


def make_truth(order_id: str, seed: int, item_id: str, product_id: str) -> dict:
    p = catalog.BY_ID[product_id]
    mat = catalog.MATERIALS[p.cls]
    rng = _rng(order_id, seed, item_id)
    r = rng.random()
    if mat["wet_ok"] and r < 0.45:
        condition = "wet"
    elif p.upright_required and r > 0.8:
        condition = "shifted_contents"
    else:
        condition = "dry"
    dry, wet = mat["friction"]
    friction = (wet if condition == "wet" else dry) * float(rng.uniform(0.95, 1.05))
    lo, hi = mat["crush_N"]
    com = [0.0, 0.0, 0.0]
    if condition == "shifted_contents":
        com = [0.0, float(rng.choice([-1, 1]) * 0.05), -0.05]
    return {
        "order_id": order_id,
        "item_id": item_id,
        "product_id": product_id,
        "mass_kg": round(p.mass_kg * float(rng.uniform(0.95, 1.05)), 3),
        "friction": round(friction, 3),
        "crush_limit_N": round(float(rng.uniform(lo, hi)), 1),
        "condition": condition,
        "com_offset_m": com,
        "noise_seed": int(rng.integers(0, 2**31)),
    }

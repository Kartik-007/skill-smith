"""Product catalog: real scanned snacks, their visible facts, and the hidden material classes.

Visible to agents: label, description, approximate size, class name, upright_required.
Hidden (referee only, via truth.py): mass, friction, crush limit, condition, centre-of-mass offset.
"""
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np

from .config import GSO_DIR

# Material classes. Friction anchored to published dry/lubricated ranges; crush limits are set from the
# gripper calibration (control.calibrate_grips) so that each class has a narrow safe window.
# [assumption] values; see README.
# Calibrated per-finger grip forces: soft ~5 N, medium ~11 N, firm ~22 N, max ~47 N.
# "wet" only applies where it is physical (condensation on cold canisters and bottles).
MATERIALS = {
    "thin_carton": {"friction": (0.55, 0.55), "crush_N": (6.5, 9.0), "wet_ok": False},
    "candy_box": {"friction": (0.55, 0.55), "crush_N": (14.0, 19.0), "wet_ok": False},
    "dense_box": {"friction": (0.50, 0.50), "crush_N": (60.0, 80.0), "wet_ok": False},
    "canister": {"friction": (0.45, 0.15), "crush_N": (60.0, 80.0), "wet_ok": True},
    "plastic_bottle": {"friction": (0.35, 0.20), "crush_N": (13.0, 18.0), "wet_ok": True},
}


@dataclass(frozen=True)
class Product:
    id: str
    gso: str
    label: str
    description: str
    cls: str
    mass_kg: float
    split: str  # train | heldout | final
    upright_required: bool = False
    tags: tuple = field(default_factory=tuple)


PRODUCTS = [
    # train
    Product("cupcakes", "Little_Debbie_Chocolate_Cupcakes_8_ct", "Little Debbie chocolate cupcakes",
            "8 frosted cupcakes in a thin printed carton with a cellophane window", "thin_carton", 0.36, "train"),
    Product("veggie_crackers", "VANS_FIRE_ROASTED_VEGGIE_CRACKERS_GLUTEN_FREE", "Van's fire roasted veggie crackers",
            "gluten-free crackers in a tall thin cardboard box", "thin_carton", 0.17, "train", True),
    Product("nesquik", "Nestle_Nesquik_Chocolate_Powder_Flavored_Milk_Additive_109_Oz_Canister",
            "Nesquik chocolate powder canister", "10.9 oz cocoa powder in a rigid canister, often stored cold",
            "canister", 0.36, "train"),
    Product("fondant", "ReadytoUse_Rolled_Fondant_Pure_White_24_oz_box", "Rolled fondant, 24 oz",
            "a solid 24 oz block of fondant icing in a printed box", "dense_box", 0.72, "train"),
    Product("nips_peanut", "Nestle_Nips_Hard_Candy_Peanut_Butter", "Nips peanut butter hard candy",
            "4 oz of wrapped hard candies in a small box", "candy_box", 0.13, "train"),
    Product("girl_scouts_pb", "Crunch_Girl_Scouts_Candy_Bars_Peanut_Butter_Creme_78_oz_box",
            "Crunch Girl Scouts peanut butter creme bars", "7.8 oz box of individually wrapped candy bars",
            "candy_box", 0.25, "train", True),
    Product("cereal", "Vans_Cereal_Honey_Nut_Crunch_11_oz_box", "Van's honey nut crunch cereal",
            "11 oz cereal in a tall narrow box", "candy_box", 0.34, "train", True),
    # held-out: never in training orders
    Product("donut_sticks", "Little_Debbie_Donut_Sticks_6_cake_donuts_10_oz_total", "Little Debbie donut sticks",
            "6 cake donuts in a long thin carton", "thin_carton", 0.30, "heldout"),
    Product("nips_rum", "Nips_Hard_Candy_Rich_Creamy_Butter_Rum_4_oz_1133_g", "Nips butter rum hard candy",
            "4 oz of wrapped hard candies in a small box", "candy_box", 0.13, "heldout"),
    Product("girl_scouts_caramel", "Nestl_Crunch_Girl_Scouts_Cookie_Flavors_Caramel_Coconut_78_oz_box",
            "Crunch Girl Scouts caramel coconut bars", "7.8 oz box of individually wrapped candy bars",
            "candy_box", 0.25, "heldout", True),
    Product("jarrosil", "JarroSil_Activated_Silicon", "JarroSil supplement bottle",
            "a small smooth plastic bottle of liquid supplement", "plastic_bottle", 0.14, "heldout"),
    Product("momento", "Nescafe_Momento_Mocha_Specialty_Coffee_Mix_8_ct", "Nescafe Momento mocha mix",
            "8 coffee mix packets in a thin carton", "thin_carton", 0.20, "heldout"),
    # final exam
    Product("skinny_cow", "Nestl_Skinny_Cow_Heavenly_Crisp_Candy_Bar_Chocolate_Raspberry_6_pack_462_oz_total",
            "Skinny Cow heavenly crisp bars", "6 wrapped candy bars in a narrow box", "candy_box", 0.15, "final", True),
    Product("fruit_snacks", "Black_Forest_Fruit_Snacks_Juicy_Filled_Centers_10_pouches_9_oz_total",
            "Black Forest fruit snacks", "10 fruit snack pouches in a thin carton", "thin_carton", 0.28, "final"),
]
BY_ID = {p.id: p for p in PRODUCTS}


@lru_cache(maxsize=None)
def bbox(product_id: str) -> tuple[np.ndarray, np.ndarray]:
    """(size_m, centre_m) of the visual mesh in the product's own frame. Base sits at z = 0."""
    path = GSO_DIR / BY_ID[product_id].gso / "model.obj"
    verts = np.array([l.split()[1:4] for l in open(path) if l.startswith("v ")], dtype=float)
    lo, hi = verts.min(0), verts.max(0)
    return hi - lo, (hi + lo) / 2


def narrow_axis(product_id: str) -> int:
    """0 if the product is thinner along its x axis, else 1. The fingers must close along this axis."""
    size, _ = bbox(product_id)
    return 0 if size[0] < size[1] else 1


def visible(product_id: str) -> dict:
    """What an agent is allowed to know about a product."""
    p = BY_ID[product_id]
    size, _ = bbox(product_id)
    return {"product_id": p.id, "label": p.label, "description": p.description, "class": p.cls,
            "approx_size_mm": [int(round(s * 1000, -1)) for s in size], "upright_required": p.upright_required}

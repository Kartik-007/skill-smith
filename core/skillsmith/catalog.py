"""Product catalog: real scanned snacks, their visible facts, and the hidden material classes.

Visible to agents: label, description, approximate size, class name, upright_required.
Hidden (referee only, via truth.py): mass, friction, crush limit, condition, centre-of-mass offset.
"""
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np

from .config import GSO_DIR

# Material classes. Friction anchored to published dry ranges for cardboard, plastic and coated tin against
# rubber fingertips. Packaging is built for its contents, so a crush limit (newtons per finger) is the class's
# strength per kg of *nominal* contents times the product's nominal mass. The window between "slips" (grip needed
# ~ mass / friction, more when moving fast) and "crushes" then has a fixed shape per class, sits at a different
# place for every product, and is moved by the hidden per-order condition (truth.py): wet x0.4 friction, damaged
# x0.6 crush limit, overfilled / half-empty contents change the mass but not the box.
# [assumption] values; see README.
MATERIALS = {
    "thin_carton": {"friction": 0.45, "strength_N_per_kg": (30.0, 36.0)},
    "candy_box": {"friction": 0.45, "strength_N_per_kg": (36.0, 44.0)},
    "dense_box": {"friction": 0.50, "strength_N_per_kg": (60.0, 75.0)},
    "canister": {"friction": 0.45, "strength_N_per_kg": (100.0, 120.0)},
    "plastic_bottle": {"friction": 0.35, "strength_N_per_kg": (75.0, 90.0)},
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
    Product("coffeecake", "Nestle_Carnation_Cinnamon_Coffeecake_Kit_1913OZ", "Carnation cinnamon coffeecake kit",
            "19 oz baking mix kit in a sturdy box", "dense_box", 0.56, "train", True),
    Product("weston_tonic", "Weston_No_33_Signature_Sausage_Tonic_12_fl_oz", "Weston No. 33 sausage tonic",
            "12 fl oz of seasoning brine in a tall plastic bottle, kept chilled", "plastic_bottle", 0.41, "train", True),
    Product("sprinkles", "Wilton_Pearlized_Sugar_Sprinkles_525_oz_Gold", "Wilton pearlized sugar sprinkles",
            "5.25 oz of gold sugar pearls in a slim rigid shaker jar", "canister", 0.18, "train", True),
    Product("raisinets", "Nestle_Raisinets_Milk_Chocolate_35_oz_992_g", "Raisinets milk chocolate",
            "3.5 oz theater box of chocolate-covered raisins", "candy_box", 0.11, "train"),
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
    Product("memento_latte", "Nescafe_Memento_Latte_Caramel_8_08_oz_23_g_packets_64_oz_184_g",
            "Nescafe Memento caramel latte mix", "8 latte mix packets (6.4 oz) in a thin carton", "thin_carton", 0.20,
            "heldout"),
    Product("elderberry", "Black_Elderberry_Syrup_54_oz_Gaia_Herbs", "Gaia Herbs black elderberry syrup",
            "5.4 fl oz of syrup in a bottle, refrigerate after opening", "plastic_bottle", 0.27, "heldout", True),
    Product("skinny_cow_clusters", "Nestle_Skinny_Cow_Dreamy_Clusters_Candy_Dark_Chocolate_6_pack_1_oz_pouches",
            "Skinny Cow dreamy clusters", "6 one-ounce candy pouches in a box", "candy_box", 0.19, "heldout", True),
    # final exam
    Product("skinny_cow", "Nestl_Skinny_Cow_Heavenly_Crisp_Candy_Bar_Chocolate_Raspberry_6_pack_462_oz_total",
            "Skinny Cow heavenly crisp bars", "6 wrapped candy bars in a narrow box", "candy_box", 0.15, "final", True),
    Product("fruit_snacks", "Black_Forest_Fruit_Snacks_Juicy_Filled_Centers_10_pouches_9_oz_total",
            "Black Forest fruit snacks", "10 fruit snack pouches in a thin carton", "thin_carton", 0.28, "final"),
    Product("herring", "Polar_Herring_Fillets_Smoked_Peppered_705_oz_total", "Polar smoked herring fillets",
            "7.05 oz tin of fish fillets in a printed sleeve, kept chilled", "canister", 0.24, "final"),
    Product("mastic_gum", "Mastic_Gum", "Mastic gum capsules", "a small round plastic bottle of supplement capsules",
            "plastic_bottle", 0.09, "final"),
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

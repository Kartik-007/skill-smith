#!/usr/bin/env bash
# Sparse-clones the Franka Panda (MuJoCo Menagerie) and the scanned products we use into core/assets (gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets

PRODUCTS=(
  Vans_Cereal_Honey_Nut_Crunch_11_oz_box
  Nestle_Nesquik_Chocolate_Powder_Flavored_Milk_Additive_109_Oz_Canister
  Big_O_Sponges_Assorted_Cellulose_12_pack
  Little_Debbie_Chocolate_Cupcakes_8_ct
  Little_Debbie_Donut_Sticks_6_cake_donuts_10_oz_total
  VANS_FIRE_ROASTED_VEGGIE_CRACKERS_GLUTEN_FREE
  Crunch_Girl_Scouts_Candy_Bars_Peanut_Butter_Creme_78_oz_box
  Nestl_Crunch_Girl_Scouts_Cookie_Flavors_Caramel_Coconut_78_oz_box
  ReadytoUse_Rolled_Fondant_Pure_White_24_oz_box
  Swiss_Miss_Hot_Cocoa_KCups_Milk_Chocolate_12_count
  The_Coffee_Bean_Tea_Leaf_KCup_Packs_Jasmine_Green_Tea_16_count
  Nestle_Nips_Hard_Candy_Peanut_Butter
  Nips_Hard_Candy_Rich_Creamy_Butter_Rum_4_oz_1133_g
  Orbit_Bubblemint_Mini_Bottle_6_ct
  JarroSil_Activated_Silicon
  Nescafe_Tasters_Choice_Instant_Coffee_Decaf_House_Blend_Light_7_oz
  Don_Franciscos_Gourmet_Coffee_Medium_Decaf_100_Colombian_12_oz_340_g
  Nestle_Raisinets_Milk_Chocolate_35_oz_992_g
  Nescafe_Momento_Mocha_Specialty_Coffee_Mix_8_ct
  Black_Forest_Fruit_Snacks_Juicy_Filled_Centers_10_pouches_9_oz_total
  Nestle_Candy_19_oz_Butterfinger_Singles_116567
  Nestl_Skinny_Cow_Heavenly_Crisp_Candy_Bar_Chocolate_Raspberry_6_pack_462_oz_total
)

if [ ! -d assets/menagerie ]; then
  git clone --depth 1 --filter=blob:none --sparse https://github.com/google-deepmind/mujoco_menagerie.git assets/menagerie
fi
git -C assets/menagerie sparse-checkout set franka_emika_panda

if [ ! -d assets/gso ]; then
  git clone --depth 1 --filter=blob:none --sparse https://github.com/kevinzakka/mujoco_scanned_objects.git assets/gso
fi
git -C assets/gso sparse-checkout set $(printf 'models/%s ' "${PRODUCTS[@]}")
echo "assets ready: $(ls assets/gso/models | wc -l | tr -d ' ') products"

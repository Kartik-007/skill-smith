# Parked: stacking and bigger orders (v2 changes C + D)

Parked on 2026-10-11 to get v2 working end to end with 3-item orders first. `stacking_4to6_items_wip.patch`
applies on top of commit `90a82e7` (`git apply docs/parked/stacking_4to6_items_wip.patch`).

## What the patch has
- `api.place(id, slot, on_top_of=other_id)`, at most two high; placement height from the bottom item's measured top.
- Referee family `ordering`: load from a product resting on an item, compared with its crush limit; end checks for
  "fell off the stack" and tilt of stacked items. Monitor state for this is in the checkpoint.
- 8 extra scanned products (coffeecake kit, Weston tonic, sprinkles, Raisinets, Memento latte, elderberry syrup,
  Skinny Cow clusters, herring, mastic gum) with `fetch_assets.sh` entries.
- Carry routing: lift only over items standing between the pick and the box, travel to a point in front of the
  target lane, then along the lane.
- Layout: 3 lanes (x 0.32 / 0.47 / 0.62, y -0.27), 5 staging spots (front row y 0.22, back row y 0.54).

## What we learned
- Upright stacking is stable in this sim: 5 of 6 test pairs stood at 0 degrees tilt.
- Reach (measured with top-down TCP moves on a grid): good out to ~0.78 m from the base at mid height, only
  ~0.65 m with the TCP ~0.9 m up (lifting over a tall stack), and the wrist misbehaves closer than ~0.42 m. There is
  also an IK pocket around x = 0.70 at table height. A 4-lane box plus two full staging rows doesn't fit; 3 lanes
  plus stacking (capacity 6) does.
- With that layout, all 60 pick/place combinations (short and tall item, 15 cm and 33 cm carry, every staging spot
  to every lane) succeed, and a scripted 5-item order with two stacks packed 5/5.

## Not done
- The "bad ordering" scripted run (fondant on veggie crackers) showed unexplained slips; not debugged.
- Suites, time budgets, queue step counts and the oracle were not updated for 5-item orders.

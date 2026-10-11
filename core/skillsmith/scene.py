"""Builds the MuJoCo world for one order: table, Panda, MongoDB-green snack box, and the order's products.

Each product = textured scanned mesh for looks (no collision) + one box proxy with the real mass for physics.
The same scene spec always builds the same model, which is what makes checkpoints restorable.
"""
import math

import mujoco
import numpy as np

from . import catalog
from .config import PANDA_XML

TABLE_Z = 0.40
TABLE_CENTRE_X = 0.55
# Tote interior (metres, world frame)
TOTE_CENTRE = np.array([0.50, -0.30])
TOTE_INNER = np.array([0.44, 0.34])
TOTE_WALL_H = 0.10
TOTE_WALL_T = 0.008
TOTE_FLOOR_T = 0.006
TOTE_FLOOR_Z = TABLE_Z + TOTE_FLOOR_T
# Three lanes along x, 15 cm apart: the Panda hand is ~20 cm wide along the finger axis, so neighbours closer than
# that get hit by the hand. Products stand upright with their long side along y.
SLOTS = {f"S{i + 1}": np.array([TOTE_CENTRE[0] - 0.15 + 0.15 * i, TOTE_CENTRE[1]]) for i in range(3)}
# Staging positions along x at y = +0.25
STAGING = [np.array([0.33 + 0.15 * i, 0.25]) for i in range(3)]

HOME_QPOS = np.array([0, 0, 0, -1.57079, 0, 1.57079, -0.7853])
GREEN = "0.0 0.41 0.29 1"
GREEN_LIGHT = "0.30 0.62 0.45 1"


def _world_xml(items: list[dict], truth: dict) -> str:
    assets, bodies = [], []
    for it in items:
        p = catalog.BY_ID[it["product_id"]]
        size, centre = catalog.bbox(p.id)
        t = truth[it["id"]]
        gdir = catalog.GSO_DIR / p.gso
        iid = it["id"]
        assets.append(
            f'<mesh name="mesh_{iid}" file="{gdir / "model.obj"}"/>'
            f'<texture name="tex_{iid}" type="2d" file="{gdir / "texture.png"}"/>'
            f'<material name="mat_{iid}" texture="tex_{iid}" specular="0.25" shininess="0.3"/>'
        )
        x, y = it["stage_pos"]
        # Rotate so the narrow side lies along world x (the hand closes along world x at yaw 0).
        yaw = 0.0 if catalog.narrow_axis(p.id) == 0 else math.pi / 2
        it["stage_yaw"] = yaw
        mass = t["mass_kg"]
        com = np.array(t["com_offset_m"])
        frac = 0.35 if np.linalg.norm(com) > 0 else 0.0  # part of the mass sits at the offset ("shifted contents")
        half = size / 2
        bodies.append(f"""
    <body name="item_{iid}" pos="{x} {y} {TABLE_Z + 0.0005}" euler="0 0 {yaw}">
      <freejoint name="jnt_{iid}"/>
      <geom name="vis_{iid}" type="mesh" mesh="mesh_{iid}" material="mat_{iid}" contype="0" conaffinity="0"
            group="2" density="0"/>
      <geom name="col_{iid}" type="box" size="{half[0]} {half[1]} {half[2]}" pos="{centre[0]} {centre[1]} {half[2]}"
            mass="{mass * (1 - frac)}" friction="{t['friction']} 0.006 0.0005" priority="1" condim="4"
            rgba="1 0 0 0" group="3"/>
      <geom name="com_{iid}" type="sphere" size="0.004" pos="{centre[0] + com[0]} {centre[1] + com[1]} {half[2] + com[2]}"
            mass="{max(mass * frac, 1e-4)}" contype="0" conaffinity="0" group="5" rgba="0 0 0 0"/>
    </body>""")

    cx, cy = TOTE_CENTRE
    ix, iy = TOTE_INNER / 2
    wt, wh = TOTE_WALL_T / 2, TOTE_WALL_H / 2
    tote = f"""
    <body name="tote" pos="{cx} {cy} {TABLE_Z}">
      <geom name="tote_floor" type="box" size="{ix + 2 * wt} {iy + 2 * wt} {TOTE_FLOOR_T / 2}" pos="0 0 {TOTE_FLOOR_T / 2}" rgba="{GREEN_LIGHT}"/>
      <geom name="tote_wall_xn" type="box" size="{wt} {iy + 2 * wt} {wh}" pos="{-ix - wt} 0 {wh}" rgba="{GREEN}"/>
      <geom name="tote_wall_xp" type="box" size="{wt} {iy + 2 * wt} {wh}" pos="{ix + wt} 0 {wh}" rgba="{GREEN}"/>
      <geom name="tote_wall_yn" type="box" size="{ix} {wt} {wh}" pos="0 {-iy - wt} {wh}" rgba="{GREEN}"/>
      <geom name="tote_wall_yp" type="box" size="{ix} {wt} {wh}" pos="0 {iy + wt} {wh}" rgba="{GREEN}"/>
    </body>"""

    return f"""
<mujoco model="skillsmith">
  <compiler angle="radian"/>
  <option timestep="0.002" integrator="implicitfast" cone="elliptic" impratio="10"/>
  <visual>
    <quality shadowsize="8192" offsamples="8"/>
    <global offwidth="1280" offheight="720" azimuth="145" elevation="-25"/>
    <headlight ambient="0.25 0.25 0.25" diffuse="0.3 0.3 0.3" specular="0 0 0"/>
  </visual>
  <asset>
    <texture name="floor_tex" type="2d" builtin="checker" rgb1="0.20 0.21 0.23" rgb2="0.17 0.18 0.20" width="512" height="512"/>
    <material name="floor_mat" texture="floor_tex" texrepeat="8 8" reflectance="0.05"/>
    <texture name="wood_tex" type="2d" builtin="flat" rgb1="0.80 0.74 0.64" width="64" height="64" mark="random" random="0.08" markrgb="0.72 0.66 0.56"/>
    <material name="wood" texture="wood_tex" specular="0.2" shininess="0.2"/>
    <material name="cardboard" specular="0.05" shininess="0.05"/>
    <material name="steel" rgba="0.55 0.57 0.6 1" specular="0.6" shininess="0.6"/>
    {''.join(assets)}
  </asset>
  <worldbody>
    <light name="sun_key" directional="true" pos="0 0 3" dir="-0.4 0.3 -1" diffuse="0.65 0.65 0.62" castshadow="true"/>
    <light name="sun_fill" directional="true" pos="0 0 3" dir="0.5 -0.6 -1" diffuse="0.25 0.25 0.28" castshadow="false"/>
    <light name="sun_back" directional="true" pos="0 0 3" dir="0.2 0.8 -0.6" diffuse="0.15 0.15 0.15" castshadow="false"/>
    <geom name="floor" type="plane" size="4 4 0.1" material="floor_mat"/>
    <geom name="table_top" type="box" size="0.40 0.60 0.02" pos="{TABLE_CENTRE_X} 0 {TABLE_Z - 0.02}" material="wood"/>
    <geom name="table_leg1" type="box" size="0.02 0.02 0.19" pos="{TABLE_CENTRE_X - 0.36} 0.56 0.19" material="steel"/>
    <geom name="table_leg2" type="box" size="0.02 0.02 0.19" pos="{TABLE_CENTRE_X + 0.36} 0.56 0.19" material="steel"/>
    <geom name="table_leg3" type="box" size="0.02 0.02 0.19" pos="{TABLE_CENTRE_X - 0.36} -0.56 0.19" material="steel"/>
    <geom name="table_leg4" type="box" size="0.02 0.02 0.19" pos="{TABLE_CENTRE_X + 0.36} -0.56 0.19" material="steel"/>
    <geom name="pedestal" type="cylinder" size="0.12 {TABLE_Z / 2}" pos="0 0 {TABLE_Z / 2}" rgba="0.12 0.12 0.14 1"/>
    {tote}
    {''.join(bodies)}
  </worldbody>
</mujoco>"""


def build(scene_spec: dict) -> tuple[mujoco.MjModel, dict]:
    """scene_spec = {"items": [{"id", "product_id", "stage_pos"}], "truth": {item_id: {...}}}.

    Returns the compiled model and an index of useful ids.
    """
    items = [dict(it) for it in scene_spec["items"]]
    spec = mujoco.MjSpec.from_string(_world_xml(items, scene_spec["truth"]))
    panda = mujoco.MjSpec.from_file(str(PANDA_XML))
    panda.meshdir = str(PANDA_XML.parent / "assets")
    panda.texturedir = str(PANDA_XML.parent / "assets")
    for key in list(panda.keys):
        panda.delete(key)
    for body in panda.bodies:
        body.gravcomp = 1.0  # position servos track accurately without sagging
    frame = spec.worldbody.add_frame(pos=[0, 0, TABLE_Z])
    spec.attach(panda, prefix="", frame=frame)
    model = spec.compile()

    idx = {
        "arm_qpos": np.array([model.joint(f"joint{i}").qposadr[0] for i in range(1, 8)]),
        "arm_dof": np.array([model.joint(f"joint{i}").dofadr[0] for i in range(1, 8)]),
        "finger_qpos": np.array([model.joint(f"finger_joint{i}").qposadr[0] for i in (1, 2)]),
        "hand": model.body("hand").id,
        "fingers": {model.body("left_finger").id, model.body("right_finger").id},
        "tote_geoms": {model.geom(n).id for n in ("tote_wall_xn", "tote_wall_xp", "tote_wall_yn", "tote_wall_yp")},
        "tote_floor": model.geom("tote_floor").id,
        "items": {},
        "stage_yaw": {it["id"]: it["stage_yaw"] for it in items},
    }
    arm_bodies = {model.body(n).id for n in ("link1", "link2", "link3", "link4", "link5", "link6", "link7", "hand")}
    idx["arm_bodies"] = arm_bodies | idx["fingers"]
    for it in items:
        iid = it["id"]
        size, _ = catalog.bbox(it["product_id"])
        idx["items"][iid] = {
            "body": model.body(f"item_{iid}").id,
            "geom": model.geom(f"col_{iid}").id,
            "vis_geom": model.geom(f"vis_{iid}").id,
            "qpos": model.joint(f"jnt_{iid}").qposadr[0],
            "size": size,
            "product_id": it["product_id"],
        }
    return model, idx


def reset_home(model: mujoco.MjModel, data: mujoco.MjData, idx: dict) -> None:
    mujoco.mj_resetData(model, data)
    data.qpos[idx["arm_qpos"]] = HOME_QPOS
    data.qpos[idx["finger_qpos"]] = 0.04
    data.ctrl[:7] = HOME_QPOS
    data.ctrl[7] = 255
    mujoco.mj_forward(model, data)

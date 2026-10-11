"""Deterministic referee. Never an LLM.

`Monitor` is a physics observer: after every step it reads the contacts and keeps, per item, the peak smoothed
finger force, slips while held, and hard hits against the box walls. `judge_item` turns that plus the final pose
into one verdict per item: ok, or the first failing family.

The referee is the only module that receives hidden truth (crush limits) and it only ever reports families,
coarse forces and labels, never the hidden numbers themselves.
"""
import math

import mujoco
import numpy as np

from .scene import TOTE_CENTRE, TOTE_INNER, TOTE_FLOOR_Z, TOTE_WALL_H

FAMILIES = ["crush", "slip", "collision", "tip", "in_box", "over_budget", "ordering"]
SLIP_DROP_M = 0.02
TIP_DEG = 30.0
COLLISION_N = 8.0
FORCE_TAU_S = 0.03
TINT = {
    "crush": [0.9, 0.1, 0.1, 0.55],
    "slip": [0.6, 0.2, 0.9, 0.55],
    "collision": [1.0, 0.85, 0.1, 0.55],
    "tip": [1.0, 0.5, 0.0, 0.55],
    "in_box": [0.5, 0.5, 0.5, 0.55],
    "over_budget": [0.3, 0.3, 0.9, 0.55],
    "ordering": [0.9, 0.1, 0.6, 0.55],
    "ok": [0.1, 0.9, 0.4, 0.35],
}


class Monitor:
    def __init__(self, model: mujoco.MjModel, data: mujoco.MjData, idx: dict, robot):
        self.m, self.d, self.idx, self.robot = model, data, idx, robot
        self.body_to_item = {it["body"]: iid for iid, it in idx["items"].items()}
        self.wall_geoms = idx["tote_geoms"]
        self.arm_bodies = idx["arm_bodies"]
        left = model.body("left_finger").id
        self.finger_side = {left: 0, model.body("right_finger").id: 1}
        self.alpha = model.opt.timestep / FORCE_TAU_S
        self.ema = {iid: np.zeros(2) for iid in idx["items"]}
        self.peak_N = {iid: 0.0 for iid in idx["items"]}
        self.peak_t = {iid: 0.0 for iid in idx["items"]}
        self.events: dict[str, list] = {iid: [] for iid in idx["items"]}  # (time, family, detail)
        # Stacking: smoothed load each item carries from products resting on it, its peak, and who caused it.
        self.load_ema = {iid: 0.0 for iid in idx["items"]}
        self.load_peak = {iid: 0.0 for iid in idx["items"]}
        self.load_by: dict[str, str | None] = {iid: None for iid in idx["items"]}
        self.stacked_on: dict[str, str] = {}  # top item -> the item it was placed on
        self.held: str | None = None
        self.held_offset: float | None = None
        self._f = np.zeros(6)

    # The executor tells the monitor what the hand is doing.
    def start_hold(self, iid: str) -> None:
        self.held = iid
        tcp, _ = self.robot.tcp()
        self.held_offset = tcp[2] - self.d.xpos[self.idx["items"][iid]["body"]][2]

    def end_hold(self) -> None:
        self.held, self.held_offset = None, None

    def _event(self, iid: str, family: str, detail: str) -> None:
        if not any(e[1] == family for e in self.events[iid]):
            self.events[iid].append((round(float(self.d.time), 3), family, detail))

    def __call__(self) -> None:
        m, d = self.m, self.d
        finger_force = {iid: np.zeros(2) for iid in self.ema}
        load = {iid: 0.0 for iid in self.ema}
        top_load: dict[str, tuple[float, str]] = {}
        for i in range(d.ncon):
            c = d.contact[i]
            b1, b2 = m.geom_bodyid[c.geom1], m.geom_bodyid[c.geom2]
            i1, i2 = self.body_to_item.get(b1), self.body_to_item.get(b2)
            if i1 is None and i2 is None:
                # arm hitting the box walls
                if (b1 in self.arm_bodies and c.geom2 in self.wall_geoms) or (b2 in self.arm_bodies and c.geom1 in self.wall_geoms):
                    mujoco.mj_contactForce(m, d, i, self._f)
                    if self._f[0] > COLLISION_N and self.held:
                        self._event(self.held, "collision", f"arm hit the box wall ({self._f[0]:.0f} N)")
                continue
            for iid, other_body, other_geom in ((i1, b2, c.geom2), (i2, b1, c.geom1)):
                if iid is None:
                    continue
                if other_body in self.finger_side:
                    mujoco.mj_contactForce(m, d, i, self._f)
                    finger_force[iid][self.finger_side[other_body]] += self._f[0]
                elif iid == self.held and (other_geom in self.wall_geoms or other_body in self.body_to_item):
                    mujoco.mj_contactForce(m, d, i, self._f)
                    if self._f[0] > COLLISION_N:
                        what = "the box wall" if other_geom in self.wall_geoms else "another product"
                        self._event(iid, "collision", f"hit {what} while carried ({self._f[0]:.0f} N)")
                elif other_body in self.body_to_item and iid != self.held:
                    # Load from a product resting on this one (its base sits above this item's middle).
                    other = self.body_to_item[other_body]
                    me = self.idx["items"][iid]
                    if d.xpos[other_body][2] > d.xpos[me["body"]][2] + 0.5 * me["size"][2]:
                        mujoco.mj_contactForce(m, d, i, self._f)
                        load[iid] += self._f[0]
                        if self._f[0] > top_load.get(iid, (0.0, ""))[0]:
                            top_load[iid] = (self._f[0], other)
        for iid, f in finger_force.items():
            self.ema[iid] += self.alpha * (f - self.ema[iid])
            peak = float(self.ema[iid].max())
            if peak > self.peak_N[iid]:
                self.peak_N[iid], self.peak_t[iid] = peak, float(d.time)
            self.load_ema[iid] += self.alpha * (load[iid] - self.load_ema[iid])
            if self.load_ema[iid] > self.load_peak[iid]:
                self.load_peak[iid] = float(self.load_ema[iid])
                if iid in top_load:
                    self.load_by[iid] = top_load[iid][1]
        if self.held is not None:
            tcp, _ = self.robot.tcp()
            z_item = d.xpos[self.idx["items"][self.held]["body"]][2]
            if (tcp[2] - z_item) - self.held_offset > SLIP_DROP_M:
                self._event(self.held, "slip", "slid out of the fingers while carried")


def tilt_deg(data: mujoco.MjData, body: int) -> float:
    return math.degrees(math.acos(float(np.clip(data.xmat[body].reshape(3, 3)[2, 2], -1, 1))))


def in_box(data: mujoco.MjData, body: int) -> bool:
    x, y, z = data.xpos[body]
    lo = TOTE_CENTRE - TOTE_INNER / 2
    hi = TOTE_CENTRE + TOTE_INNER / 2
    # Stacked items sit up to ~30 cm above the floor; the footprint check is what matters.
    return bool(lo[0] < x < hi[0] and lo[1] < y < hi[1] and TOTE_FLOOR_Z - 0.01 < z < TOTE_FLOOR_Z + 0.45)


def judge_item(mon: Monitor, iid: str, crush_limit_N: float, upright_required: bool, over_budget: bool,
               labels: dict | None = None) -> dict:
    """Per-item verdict. Earliest event wins; end-state checks come after all events.

    The packaging takes the same force from a product stacked on top as from the fingers (top-load limit =
    crush limit), so a heavy item on a fragile one is an `ordering` failure of the item underneath."""
    d, body = mon.d, mon.idx["items"][iid]["body"]
    events = list(mon.events[iid])
    if mon.peak_N[iid] > crush_limit_N:
        events.append((-1.0, "crush", "squeezed too hard by the fingers"))  # crush happens at grasp time
    events.sort(key=lambda e: e[0])
    tilt = tilt_deg(d, body)
    inside = in_box(d, body)
    stacked = iid in mon.stacked_on or iid in mon.stacked_on.values()
    base = mon.stacked_on.get(iid)
    off_stack = False
    if base is not None:  # must end resting on the item it was placed on
        b = mon.idx["items"][base]
        off_stack = d.xpos[body][2] < d.xpos[b["body"]][2] + 0.8 * b["size"][2]
    family, detail = None, ""
    if events:
        family, detail = events[0][1], events[0][2]
    elif mon.load_peak[iid] > crush_limit_N:
        who = (labels or {}).get(mon.load_by[iid], "the product") if mon.load_by[iid] else "the product"
        family, detail = "ordering", f"crushed by {who} stacked on top"
    elif not inside:
        family, detail = "in_box", "ended outside the box"
    elif off_stack:
        family, detail = "tip", "fell off the stack"
    elif (upright_required or stacked) and tilt > TIP_DEG:
        family, detail = "tip", f"ended {tilt:.0f} degrees from upright"
    elif over_budget:
        family, detail = "over_budget", "placed after the order's time budget ran out"
    if family == "slip" and inside and tilt <= TIP_DEG:
        family, detail = None, ""  # slid a little but still landed fine
    return {"id": iid, "ok": family is None, "family": family, "detail": detail,
            "peak_N": round(mon.peak_N[iid], 1), "tilt_deg": round(tilt, 1), "in_box": inside}


def coarse_force(peak_N: float) -> str:
    """What agents may see about forces: a coarse band, never the number."""
    if peak_N < 6:
        return "gentle"
    if peak_N < 14:
        return "moderate"
    if peak_N < 30:
        return "strong"
    return "very strong"

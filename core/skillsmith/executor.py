"""Runs one order in the simulator, one item (pick + place) per call, with exact save/restore between items.

This is the only place where the scene, the robot and the referee meet. Hidden truth comes in through
`scene_spec["truth"]` and leaves only as referee verdicts.
"""
import mujoco
import numpy as np

from . import catalog, referee
from .control import Robot, UnstableSim
from .scene import FRONT_Y, SLOTS, TABLE_Z, TOTE_WALL_H, build, reset_home

CLEARANCE_M = 0.03

TOOL_COST_S = 3.0


class OrderSim:
    def __init__(self, scene_spec: dict, carry_height_m: float = 0.15):
        self.spec = scene_spec
        self.model, self.idx = build(scene_spec)
        self.data = mujoco.MjData(self.model)
        reset_home(self.model, self.data, self.idx)
        self.robot = Robot(self.model, self.data, self.idx)
        self.monitor = referee.Monitor(self.model, self.data, self.idx, self.robot)
        self.robot.observers.append(self.monitor)
        self.carry_height = carry_height_m
        self.tool_time = 0.0
        self.robot.wait(0.2)
        self.robot.motion_time = 0.0

    # ---------- execution ----------
    def top_z(self, iid: str) -> float:
        """World z of an item's top face (upright items; conservative for tipped ones)."""
        it = self.idx["items"][iid]
        return float(self.data.xpos[it["body"]][2] + it["size"][2])

    def carry_height_for(self, iid: str, base: str | None = None) -> float:
        """Item-bottom height above the table for the carry: the genome's carry height, raised so the carried item
        clears the box walls, items still standing in staging between it and the box (a back-row pick crosses the
        front row), and the item it will be stacked on. Items in other lanes are never crossed (see Robot.place)."""
        need = [self.carry_height, TOTE_WALL_H + CLEARANCE_M]
        y_me = self.data.xpos[self.idx["items"][iid]["body"]][1]
        for o in self.idx["items"]:
            y = self.data.xpos[self.idx["items"][o]["body"]][1]
            if o != iid and FRONT_Y < y < y_me - 0.05:
                need.append(self.top_z(o) - TABLE_Z + CLEARANCE_M)
        if base:
            need.append(self.top_z(base) - TABLE_Z + CLEARANCE_M)
        return max(need)

    def run_item(self, action: dict) -> None:
        """action = {"item", "grip_N", "speed_mps", "slot", "on_top_of"?}. Raises UnstableSim if physics blows up.
        With on_top_of, the item is set down on that item's current top (measured, not assumed)."""
        r, mon = self.robot, self.monitor
        iid = action["item"]
        r.speed = float(action["speed_mps"])
        base = action.get("on_top_of")
        try:
            held = r.pick(iid, float(action["grip_N"]), self.carry_height_for(iid, base),
                          on_grasp=lambda: mon.start_hold(iid))
            if base:
                xy, floor_z = self.data.xpos[self.idx["items"][base]["body"]][:2].copy(), self.top_z(base)
                mon.stacked_on[iid] = base
            else:
                xy, floor_z = SLOTS[action["slot"]], None
            r.place(iid, xy, held, on_release=mon.end_hold, **({"floor_z": floor_z} if base else {}))
        finally:
            mon.end_hold()
        r.wait(0.3)

    def elapsed_s(self) -> float:
        return self.robot.motion_time + self.tool_time

    # ---------- referee ----------
    def judge(self, iid: str, over_budget: bool = False) -> dict:
        t = self.spec["truth"][iid]
        product = catalog.BY_ID[self.idx["items"][iid]["product_id"]]
        labels = {k: catalog.BY_ID[it["product_id"]].label for k, it in self.idx["items"].items()}
        v = referee.judge_item(self.monitor, iid, t["crush_limit_N"], product.upright_required, over_budget, labels)
        # After-pack inspection: the condition label (never the numbers) goes on the record, so skills and the
        # critic can say "that was the damp one".
        v["inspected"] = t.get("condition", "dry")
        return v

    def tint(self, renderer, verdicts: list[dict]) -> None:
        for v in verdicts:
            if v["family"]:  # only failures are highlighted; clean packs keep their real packaging
                renderer.tints[self.idx["items"][v["id"]]["vis_geom"]] = np.array(referee.TINT[v["family"]])

    # ---------- checkpoints ----------
    def snapshot(self) -> dict:
        size = mujoco.mj_stateSize(self.model, mujoco.mjtState.mjSTATE_INTEGRATION)
        state = np.empty(size)
        mujoco.mj_getState(self.model, self.data, state, mujoco.mjtState.mjSTATE_INTEGRATION)
        mon = self.monitor
        return {
            "state": state.tolist(),
            "control": self.robot.control_state(),
            "motion_time": self.robot.motion_time,
            "tool_time": self.tool_time,
            "monitor": {"peak_N": dict(mon.peak_N), "events": {k: [list(e) for e in v] for k, v in mon.events.items()},
                        "ema": {k: v.tolist() for k, v in mon.ema.items()}, "load_ema": dict(mon.load_ema),
                        "load_peak": dict(mon.load_peak), "load_by": dict(mon.load_by),
                        "stacked_on": dict(mon.stacked_on)},
        }

    def restore(self, snap: dict) -> None:
        state = np.array(snap["state"], dtype=float)
        mujoco.mj_setState(self.model, self.data, state, mujoco.mjtState.mjSTATE_INTEGRATION)
        self.robot.load_control_state(snap["control"])
        self.robot.motion_time = snap["motion_time"]
        self.tool_time = snap["tool_time"]
        mon = self.monitor
        mon.peak_N = dict(snap["monitor"]["peak_N"])
        mon.events = {k: [tuple(e) for e in v] for k, v in snap["monitor"]["events"].items()}
        mon.ema = {k: np.array(v) for k, v in snap["monitor"]["ema"].items()}
        mon.load_ema = dict(snap["monitor"]["load_ema"])
        mon.load_peak = dict(snap["monitor"]["load_peak"])
        mon.load_by = dict(snap["monitor"]["load_by"])
        mon.stacked_on = dict(snap["monitor"]["stacked_on"])
        mujoco.mj_forward(self.model, self.data)


__all__ = ["OrderSim", "UnstableSim", "TOOL_COST_S"]

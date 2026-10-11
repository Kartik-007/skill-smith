"""Runs one order in the simulator, one item (pick + place) per call, with exact save/restore between items.

This is the only place where the scene, the robot and the referee meet. Hidden truth comes in through
`scene_spec["truth"]` and leaves only as referee verdicts.
"""
import mujoco
import numpy as np

from . import catalog, referee
from .control import Robot, UnstableSim
from .scene import SLOTS, build, reset_home

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
    def run_item(self, action: dict) -> None:
        """action = {"item", "grip", "speed", "slot"}. Raises UnstableSim if physics blows up."""
        r, mon = self.robot, self.monitor
        iid = action["item"]
        r.speed = action["speed"]
        try:
            held = r.pick(iid, action["grip"], self.carry_height, on_grasp=lambda: mon.start_hold(iid))
            r.place(iid, SLOTS[action["slot"]], held, on_release=mon.end_hold)
        finally:
            mon.end_hold()
        r.wait(0.3)

    def elapsed_s(self) -> float:
        return self.robot.motion_time + self.tool_time

    # ---------- referee ----------
    def judge(self, iid: str, over_budget: bool = False) -> dict:
        t = self.spec["truth"][iid]
        product = catalog.BY_ID[self.idx["items"][iid]["product_id"]]
        return referee.judge_item(self.monitor, iid, t["crush_limit_N"], product.upright_required, over_budget)

    def tint(self, renderer, verdicts: list[dict]) -> None:
        for v in verdicts:
            renderer.tints[self.idx["items"][v["id"]]["vis_geom"]] = np.array(referee.TINT[v["family"] or "ok"])

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
                        "ema": {k: v.tolist() for k, v in mon.ema.items()}},
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
        mujoco.mj_forward(self.model, self.data)


__all__ = ["OrderSim", "UnstableSim", "TOOL_COST_S"]

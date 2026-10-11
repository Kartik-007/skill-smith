"""Arm control: damped-least-squares IK on a separate MjData holding the commanded joints, min-jerk Cartesian
segments, and a force-controlled gripper with four grip levels.

Every motion advances the physics with `Robot.step`, which calls the registered observers (referee monitor,
video recorder) after each physics step.
"""
import math
from typing import Callable

import mujoco
import numpy as np

from .scene import TABLE_Z, TOTE_FLOOR_Z

TCP_OFFSET = np.array([0.0, 0.0, 0.1034])
GRASP_DEPTH = 0.025  # pads centred this far below the item top; the hand body sits ~2 cm above it
# Tendon force (N) when closing. Each finger gets about half. Calibrated in calibrate_grips().
GRIP_FORCE = {"soft": 9.0, "medium": 20.0, "firm": 40.0, "max": 85.0}
GRIP_LEVELS = list(GRIP_FORCE)
SPEED_MPS = {"slow": 0.15, "normal": 0.35, "fast": 0.8}
SETTLE_S = {"slow": 0.30, "normal": 0.15, "fast": 0.02}
MAX_JOINT_STEP = {"slow": 1.5, "normal": 2.5, "fast": 5.0}  # rad/s clip on the commanded joints
GRIPPER = 7  # actuator index of the finger tendon
OPEN_GAIN = 100 / 255 * 0.04  # Menagerie position-servo gain


class UnstableSim(RuntimeError):
    pass


def topdown_rot(yaw: float) -> np.ndarray:
    """Hand frame pointing straight down, fingers closing along world (cos yaw, sin yaw, 0)."""
    y = np.array([math.cos(yaw), math.sin(yaw), 0.0])
    z = np.array([0.0, 0.0, -1.0])
    x = np.cross(y, z)
    return np.column_stack([x, y, z])


def _min_jerk(s: float) -> float:
    return 10 * s**3 - 15 * s**4 + 6 * s**5


class Robot:
    def __init__(self, model: mujoco.MjModel, data: mujoco.MjData, idx: dict):
        self.m, self.d, self.idx = model, data, idx
        self.ik = mujoco.MjData(model)
        self.q_des = data.qpos[idx["arm_qpos"]].copy()
        self.q_home = self.q_des.copy()
        self.observers: list[Callable[[], None]] = []
        self.speed = "normal"
        self.motion_time = 0.0
        self.grip = {"mode": "open", "level": None, "width": 0.04}
        self._jacp = np.zeros((3, model.nv))
        self._jacr = np.zeros((3, model.nv))

    # ---------- state needed to resume from a checkpoint ----------
    def control_state(self) -> dict:
        return {"q_des": self.q_des.tolist(), "grip": dict(self.grip)}

    def load_control_state(self, st: dict) -> None:
        self.q_des = np.array(st["q_des"])
        g = st["grip"]
        if g["mode"] == "open":
            self.open(g["width"], wait=0)
        else:
            self.close(g["level"], wait=0)

    # ---------- kinematics ----------
    def tcp(self, data: mujoco.MjData | None = None) -> tuple[np.ndarray, np.ndarray]:
        d = data or self.d
        h = self.idx["hand"]
        rot = d.xmat[h].reshape(3, 3)
        return d.xpos[h] + rot @ TCP_OFFSET, rot

    def _ik_step(self, p_des: np.ndarray, r_des: np.ndarray, max_step: float) -> None:
        m, ik, idx = self.m, self.ik, self.idx
        ik.qpos[idx["arm_qpos"]] = self.q_des
        mujoco.mj_kinematics(m, ik)
        mujoco.mj_comPos(m, ik)
        p, r = self.tcp(ik)
        err = np.concatenate([p_des - p, 0.5 * sum(np.cross(r[:, i], r_des[:, i]) for i in range(3))])
        mujoco.mj_jac(m, ik, self._jacp, self._jacr, p, idx["hand"])
        J = np.vstack([self._jacp, self._jacr])[:, idx["arm_dof"]]
        JJt = J @ J.T + 1e-4 * np.eye(6)
        J_pinv = J.T @ np.linalg.solve(JJt, np.eye(6))
        dq = J_pinv @ err
        dq += (np.eye(7) - J_pinv @ J) @ (0.02 * (self.q_home - self.q_des))
        self.q_des = self.q_des + np.clip(dq, -max_step, max_step)
        lo, hi = m.jnt_range[[m.joint(f"joint{i}").id for i in range(1, 8)]].T
        self.q_des = np.clip(self.q_des, lo + 1e-3, hi - 1e-3)

    # ---------- stepping ----------
    def step(self, n: int = 1) -> None:
        m, d = self.m, self.d
        for _ in range(n):
            d.ctrl[:7] = self.q_des
            mujoco.mj_step(m, d)
            if d.warning[mujoco.mjtWarning.mjWARN_BADQACC].number:
                raise UnstableSim("simulation unstable (bad qacc)")
            for obs in self.observers:
                obs()
        self.motion_time += n * m.opt.timestep

    def wait(self, seconds: float) -> None:
        if seconds > 0:
            self.step(max(1, int(round(seconds / self.m.opt.timestep))))

    def move(self, p_goal, yaw: float, speed: str | None = None, min_t: float = 0.25) -> None:
        """Straight-line min-jerk TCP move to p_goal with a top-down hand at yaw."""
        speed = speed or self.speed
        self.ik.qpos[self.idx["arm_qpos"]] = self.q_des
        mujoco.mj_kinematics(self.m, self.ik)
        p0, r0 = self.tcp(self.ik)
        p_goal = np.asarray(p_goal, float)
        r_goal = topdown_rot(yaw)
        dist = float(np.linalg.norm(p_goal - p0))
        ang = float(np.linalg.norm(0.5 * sum(np.cross(r0[:, i], r_goal[:, i]) for i in range(3))))
        T = max(min_t, dist / SPEED_MPS[speed], ang / 1.5)
        dt = self.m.opt.timestep
        n = int(math.ceil(T / dt))
        max_step = MAX_JOINT_STEP[speed] * dt
        for k in range(1, n + 1):
            s = _min_jerk(k / n)
            p = p0 + s * (p_goal - p0)
            # Orientation: blend by re-orthonormalising (small yaw changes only)
            r = r0 + s * (r_goal - r0)
            u, _, vt = np.linalg.svd(r)
            r = u @ vt
            for _ in range(2):
                self._ik_step(p, r, max_step)
            self.step()
        # converge
        for _ in range(int(0.08 / dt)):
            self._ik_step(p_goal, r_goal, max_step)
            self.step()

    # ---------- gripper ----------
    def open(self, width: float = 0.08, wait: float = 0.3) -> None:
        half = float(np.clip(width / 2, 0.0, 0.04))
        m = self.m
        m.actuator_gainprm[GRIPPER, 0] = OPEN_GAIN
        m.actuator_biasprm[GRIPPER, :3] = [0, -100, -10]
        self.d.ctrl[GRIPPER] = half * 100 / OPEN_GAIN
        self.grip = {"mode": "open", "level": None, "width": width}
        self.wait(wait)

    def close(self, level: str, wait: float = 0.45) -> None:
        """Force-controlled close. The force ramps up over 0.15 s so the fingers don't slam into the item."""
        m = self.m
        force = GRIP_FORCE[level]
        m.actuator_gainprm[GRIPPER, 0] = 0.0
        m.actuator_biasprm[GRIPPER, :3] = [0, 0, -20]
        self.d.ctrl[GRIPPER] = 0.0
        self.grip = {"mode": "closed", "level": level, "width": 0.0}
        n_ramp = max(1, int(0.15 / m.opt.timestep)) if wait > 0 else 1
        for k in range(1, n_ramp + 1):
            m.actuator_biasprm[GRIPPER, 0] = -force * k / n_ramp
            if wait > 0:
                self.step()
        self.wait(wait - 0.15)

    def finger_gap(self) -> float:
        return float(self.d.qpos[self.idx["finger_qpos"]].sum())

    # ---------- skills ----------
    def item_pose(self, iid: str) -> tuple[np.ndarray, np.ndarray]:
        b = self.idx["items"][iid]["body"]
        return self.d.xpos[b].copy(), self.d.xmat[b].reshape(3, 3).copy()

    def grasp_yaw(self, iid: str) -> float:
        """Yaw that puts the finger axis along the item's narrow side (its body x axis after staging)."""
        _, rot = self.item_pose(iid)
        size = self.idx["items"][iid]["size"]
        axis = rot[:, 0] if size[0] < size[1] else rot[:, 1]
        yaw = math.atan2(axis[1], axis[0])
        # Fold into (-pi/2, pi/2]: the gripper is symmetric
        while yaw > math.pi / 2:
            yaw -= math.pi
        while yaw <= -math.pi / 2:
            yaw += math.pi
        return yaw

    def pick(self, iid: str, grip: str, carry_height: float, on_grasp: Callable[[], None] | None = None) -> dict:
        """Grasp item iid just below its top (the fingers are ~5 cm long) and lift it to the carry height,
        i.e. with its bottom `carry_height` metres above the table."""
        pos, _ = self.item_pose(iid)
        size = self.idx["items"][iid]["size"]
        H = float(size[2])
        narrow = float(min(size[0], size[1]))
        yaw = self.grasp_yaw(iid)
        grasp_offset = H - GRASP_DEPTH
        self.open(narrow + 0.03, wait=0.05)
        self.move([pos[0], pos[1], pos[2] + H + 0.06], yaw)
        self.move([pos[0], pos[1], pos[2] + grasp_offset], yaw)
        self.close(grip)
        if on_grasp:
            on_grasp()
        z_carry = TABLE_Z + carry_height + grasp_offset
        self.move([pos[0], pos[1], z_carry], yaw)
        return {"yaw": yaw, "grasp_offset": grasp_offset, "z_carry": z_carry, "narrow": narrow}

    def place(self, iid: str, slot_xy, held: dict, on_release: Callable[[], None] | None = None) -> None:
        """Carry the held item over the slot, lower it to the box floor and release."""
        x, y = slot_xy
        self.move([x, y, held["z_carry"]], held["yaw"])
        self.move([x, y, TOTE_FLOOR_Z + held["grasp_offset"] + 0.006], held["yaw"])
        self.wait(SETTLE_S[self.speed])
        if on_release:
            on_release()
        self.open(held["narrow"] + 0.03, wait=0.25)
        self.move([x, y, held["z_carry"] + 0.03], held["yaw"], min_t=0.3)

    def go_home(self) -> None:
        self.ik.qpos[self.idx["arm_qpos"]] = self.q_home
        mujoco.mj_kinematics(self.m, self.ik)
        p, _ = self.tcp(self.ik)
        self.move(p, 0.0)

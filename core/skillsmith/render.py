"""Offscreen rendering: single frames and mp4 clips from the hero camera."""
from pathlib import Path

import imageio.v2 as imageio
import mujoco
import numpy as np
from PIL import Image

CAMERAS = {
    "hero": {"lookat": [0.40, -0.02, 0.58], "distance": 1.38, "azimuth": 135.0, "elevation": -23.0},
    "top": {"lookat": [0.5, -0.05, 0.4], "distance": 1.3, "azimuth": 180.0, "elevation": -89.0},
    "side": {"lookat": [0.5, -0.1, 0.5], "distance": 1.5, "azimuth": 90.0, "elevation": -20.0},
}


def camera(name: str = "hero") -> mujoco.MjvCamera:
    c = mujoco.MjvCamera()
    cfg = CAMERAS[name]
    c.lookat[:] = cfg["lookat"]
    c.distance, c.azimuth, c.elevation = cfg["distance"], cfg["azimuth"], cfg["elevation"]
    return c


class Renderer:
    def __init__(self, model: mujoco.MjModel, width: int = 1280, height: int = 720):
        self.r = mujoco.Renderer(model, height=height, width=width)
        self.opt = mujoco.MjvOption()
        self.tints: dict[int, np.ndarray] = {}  # geom id -> rgba override (referee highlights)

    def frame(self, data: mujoco.MjData, cam: str = "hero") -> np.ndarray:
        self.r.update_scene(data, camera(cam), scene_option=self.opt)
        if self.tints:
            scn = self.r.scene
            for i in range(scn.ngeom):
                g = scn.geoms[i]
                if g.objtype == mujoco.mjtObj.mjOBJ_GEOM and g.objid in self.tints:
                    g.rgba[:] = self.tints[g.objid]
        return self.r.render()

    def save_png(self, data: mujoco.MjData, path: Path, cam: str = "hero") -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(self.frame(data, cam)).save(path)


class Recorder:
    """Observer that grabs a frame every 1/fps seconds of sim time."""

    def __init__(self, model: mujoco.MjModel, data: mujoco.MjData, path: Path, fps: int = 30,
                 width: int = 1280, height: int = 720, cam: str = "hero"):
        self.m, self.d, self.fps, self.cam = model, data, fps, cam
        self.renderer = Renderer(model, width, height)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.writer = imageio.get_writer(str(path), fps=fps, codec="libx264", quality=7,
                                         macro_block_size=8, ffmpeg_params=["-pix_fmt", "yuv420p"])
        self.next_t = data.time

    def __call__(self) -> None:
        if self.d.time >= self.next_t:
            self.writer.append_data(self.renderer.frame(self.d, self.cam))
            self.next_t += 1.0 / self.fps

    def hold(self, seconds: float) -> None:
        img = self.renderer.frame(self.d, self.cam)
        for _ in range(int(seconds * self.fps)):
            self.writer.append_data(img)

    def close(self) -> None:
        self.writer.close()

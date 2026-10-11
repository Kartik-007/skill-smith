"""Paths and environment. Loads the repo-root .env.local once."""
import os
from pathlib import Path

from dotenv import load_dotenv

CORE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = CORE_DIR.parent
ASSETS_DIR = CORE_DIR / "assets"
GSO_DIR = ASSETS_DIR / "gso" / "models"
PANDA_XML = ASSETS_DIR / "menagerie" / "franka_emika_panda" / "panda.xml"
OUT_DIR = CORE_DIR / "out"
VIDEO_DIR = REPO_DIR / "web" / "public" / "videos"
FRAME_DIR = REPO_DIR / "web" / "public" / "frames"

load_dotenv(REPO_DIR / ".env.local")


def env(name: str, default: str | None = None) -> str:
    value = os.environ.get(name, default)
    if value is None:
        raise RuntimeError(f"missing env var {name} (see .env.example)")
    return value


DB_NAME = env("MONGODB_DB", "skillsmith")
TRUTH_DB_NAME = env("MONGODB_TRUTH_DB", "skillsmith_truth")
CODER_MODEL = env("CODER_MODEL", "anthropic/claude-haiku-5.5")
STRONG_MODEL = env("STRONG_MODEL", "anthropic/claude-sonnet-5.5")
DEMO_MODE = os.environ.get("SKILLSMITH_DEMO", "0") == "1"

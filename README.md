# Skill Smith

A Franka Panda arm in MuJoCo packs real, 3D-scanned snacks into a box. A cheap LLM writes the packing program. A
deterministic referee grades it with hidden physics (mass, friction, crush limit) that the agents can't read. Failures
become lessons, clean packs become reusable skills, and a meta-agent proposes one typed patch to the harness per
generation. A gate keeps the patch only if it wins on held-out orders. The night shift runs as a durable queue in
MongoDB Atlas with exact physics checkpoints, so a killed worker resumes from the same physics state.

**The model never changes. The harness does.**

Built at the MongoDB hackathon, San Francisco, 2026-10-11.

## Layout
- `core/`: Python 3.12 (uv). Simulation, referee, agents, genome and gate, durable queue.
- `web/`: Next.js screen (read-only on Atlas).

## Setup
```bash
cp .env.example .env.local   # fill in keys
cd core && ./scripts/fetch_assets.sh && uv sync
```

## Credits
- Products: [Google Scanned Objects](https://research.google/blog/scanned-objects-by-google-research-a-dataset-of-3d-scanned-common-household-items/)
  (CC-BY 4.0), MuJoCo models via [kevinzakka/mujoco_scanned_objects](https://github.com/kevinzakka/mujoco_scanned_objects) (MIT).
- Robot: Franka Emika Panda from [MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie) (Apache-2.0).
- Physics: [MuJoCo](https://mujoco.org).

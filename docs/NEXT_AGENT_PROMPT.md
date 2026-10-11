# Prompt: Skill Smith v2 (harder task, richer harness)

You are continuing **Skill Smith**, a hackathon project in `~/Developer/skill-smith` (MongoDB hackathon, SF, today).
Read `README.md`, `DEMO.md` and the code under `core/skillsmith/` before changing anything. The user wants **all six
changes below**. Work in milestones, commit after each one, and keep the project demoable at every commit.

## What exists today (working, recorded, committed)
- `core/` (Python 3.12, `uv`). MuJoCo Franka Panda packs 3 real scanned snacks into a green box with 3 slots, with an
  18 s budget per order.
  - The coder (`anthropic/claude-haiku-5.5` via OpenRouter) writes `def pack(api):`. It runs in a sandbox against a
    recording API (`skill_api.py`) that produces an action list.
  - A durable Atlas queue (`queue.py`, `worker.py`) executes `plan → place×3 → verify` steps, with leases, heartbeats,
    token-checked transactions and physics checkpoints (`mj_getState`).
  - The deterministic referee (`referee.py`) grades each item: ok or crush / slip / collision / tip / in_box /
    over_budget.
  - Memory: lessons from the critic, and skills from clean packs. Stored in Atlas with Vector Search; embeddings
    from Voyage.
  - The meta-agent (`agents/meta.py`, `claude-sonnet-5.5`) proposes one typed patch to the genome (`genome.py`).
  - The gate (`gate.py`) runs a paired bootstrap on train T / held-out H, with guardrails on family regressions,
    cycle time and cost.
  - `evolve.py` runs generations. Raindrop instrumentation is in `observe.py`, which also has read-back via
    `query_signals` when `RAINDROP_QUERY_API_KEY` is set.
- `web/`: Next.js one-screen UI that reads Atlas (`/api/state`), with a judge form and a `?replay=1` fallback.
- CLI: `uv run skillsmith seed|evolve|force|final-exam|showcase|demo-kill|live|redteam|status|oracle`.
- **Recorded result (keep it as the fallback demo):**
  - v0 H75/T29 → v1 `skills_k=3` kept (H83/T77) → v2 `lessons_k=2` kept (H89/T96).
  - v3–v8 rolled back. v9 (locked edit) rejected. v10 (strong coder) rejected by the cost guard.
  - Final exam: 78% → 100%.

**Why we're changing it:** the task is too easy to solve by lookup. The only winning patch was "retrieve what worked
before". Train saturates at 96% after two steps, so further generations can't win. v2 must make memory necessary but
not sufficient, so tools, rules, sequencing and recovery have to earn their keep. That should give a 4–6 step climb
driven by Raindrop signals.

## Ground rules
1. **Don't destroy the recorded v1 run.** Do all v2 work in new databases. Set `MONGODB_DB=skillsmith_v2` and
   `MONGODB_TRUTH_DB=skillsmith_truth_v2` in `.env.local` (both `core/config.py` and `web/` read these). Keep the
   current `web/public/replay.json` and videos as `replay_v1.json` before overwriting anything.
2. **Secrets:** `.env.local` (repo root, gitignored) holds every key. Never print, log or commit key values. Commit
   only `.env.example`.
3. **Commits:** small and per milestone, ending with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't create GitHub repos. Push only if a remote
   already exists.
4. **Honesty:**
   - Never fake results, tripwires or agent proposals.
   - Scripted patches must go through `skillsmith force` and are labelled "Guardrail test (scripted)".
   - Update README/DEMO numbers only from real runs.
5. **Write fresh code in this repo.** Keep the existing style: short modules, docstrings that explain *why*, no
   frameworks.

## Hard-won facts (don't rediscover them)
**Physics**
- The Panda hand is about 20 cm wide along the finger axis. Neighbours closer than ~15 cm get knocked over, which is
  why there are 3 lanes at 15 cm.
- The fingers are about 5 cm long, so items are grasped `GRASP_DEPTH=0.025` m below their top.
- The arm bodies have `gravcomp=1`.
- The gripper is force-controlled through `actuator_biasprm[7]`, with a 0.15 s force ramp (without it the fingers
  slam and spike).
- Per-finger force ≈ tendon force / 2. Current levels: soft 9 → ~5 N, medium 20 → ~11 N, firm 40 → ~22 N,
  max 85 → ~47 N.
- Torsional friction on the item proxies is 0.006. Fast moves load one finger, so even soft grips crush thin cartons
  at speed.
- Approximate motion time per item: slow 11.8 s, normal 6.2 s, fast 4.1 s (`SPEED_MPS` 0.15 / 0.35 / 0.8).

**Checkpoints**
- Call `mj_forward` before rendering a checkpoint frame. Otherwise positions lag one step and the restored frame
  differs (it's pixel diff 0 now).
- The same scene spec must always build the same model.

**External services**
- **Voyage is free tier (~3 requests/min).** Product query vectors are cached in `products.embedding` at seed time.
  Skills are written with `needs_embed` and embedded in one batch per generation. Keep it that way.
- **OpenRouter:** Sonnet spends tokens on reasoning, so keep `max_tokens` ≥ 3000 for meta and critic, or the content
  comes back empty.
- **Ledger replays:** runs carry the nominal `cost_usd` (used by the gate's cost guard) and the actual `spent_usd`.

**Processes (macOS)**
- Worker processes are `multiprocessing.spawn` children. `pkill -f "skillsmith evolve"` does **not** kill them, so
  orphans run old code and steal steps. Kill by PID, or by matching `multiprocessing.spawn`.
- Never write `until ! pgrep -f "skillsmith evolve"`: it matches its own shell.
- `wait_batch` restarts dead workers.

**Raindrop**
- Use the Python base SDK (`raindrop.analytics`): `track_ai` with `user_id` set (customer slug), `track_signal`, and
  a flush per run.
- Event IDs are deterministic (uuid5 including `epoch()`).

## The six changes

### A. Hidden per-order variation (memory alone must stop working)
- In `truth.py`, give every order item a condition that changes its limits beyond its product class:
  - `wet`: friction × ~0.4, only on canisters and bottles
  - `half_empty`: mass × 0.5 and a lower centre of mass
  - `damaged`: crush limit × 0.5, for cartons
  - `overfilled`: mass × 1.3
  - `shifted_contents`
  - `dry`
- The same product must need *different* handling in different orders.
- Keep it partly observable:
  - `items()` description hints appear only some of the time (e.g. 50% for wet, 30% for damaged).
  - The tools (B) are the reliable way to find out.
  - Skills should record the condition seen, so the coder learns "skill was for the dry version".

### B. Continuous controls and numeric, noisy tools
- New API: `api.pick(id, grip_N: float, speed_mps: float)`, with grip_N 2–45 per finger and speed 0.1–1.0 m/s.
  Map grip_N to tendon force (×2, calibrated) and speed into `Robot.move`.
- Re-measure the motion time per item as a function of speed, and document it in the API doc so the coder can budget.
- Tools return **noisy numbers**, never the truth:
  - `weigh(id) → kg ± 12%`
  - `squeeze_test(id) → "gives at about X N"` with ±25% noise
  - `surface_check(id) → "dry" | "damp"` with a 10% error rate
  - Each tool costs time (keep 3 s, or make it a genome knob).
- Skills store numeric ranges ("cupcakes, dry: packed clean at 4.5 N, 0.35 m/s"). Merge repeated skills into a
  min/max range.
- Re-calibrate the crush limits per class so there's a narrow window between "slips" and "crushes" that moves with
  the condition.

### C. Stacking and ordering
- Orders of 5 items with 3 slots, so at least 2 items must stack: `api.place(id, slot, on_top_of=other_id)`.
- Placement height is computed from the bottom item's current top.
- New referee family `ordering`: a product crushed by another *product* on top, not by the fingers (contact force
  from the item above over its crush limit). `Monitor` already separates finger contacts from item contacts; extend
  it.
- Final checks should also cover a stacked item ending on top of the stack (`in_box` still applies) and tipping.
- **Prototype stacking in the sim first (time box 45 min).** Tall upright boxes may be unstable stacked.
  - If so, only allow stacking on items whose top is at least 90 mm wide, or lay the top item flat.
  - If it's still unstable, fall back to 4 lanes in a bigger box.
  - Tell the user which you chose.

### D. Bigger orders (4–6 items)
- Make the box bigger (2 rows, or wider lanes). Keep at least 15 cm between neighbours along the finger axis.
- Use more staging positions within reach (Panda reach ~0.75 m horizontally at table height; keep targets inside
  that).
- Scale the time budget so that "everything at medium speed" doesn't fit.
- Add 4–8 more scanned products from `kevinzakka/mujoco_scanned_objects`: measure them with `catalog.bbox`, keep
  those with one side under 75 mm, and add them to `scripts/fetch_assets.sh`. Keep held-out products out of training
  orders.

### E. Recovery mid-order (long horizon)
- The program may also define `def recover(api, item_id, what_happened):`.
- When the referee detects a slip or drop during a place step and the item is still on the table within reach, the
  worker enqueues a new `recover` queue step:
  - checkpointed and leased like the others
  - it runs `recover()` against a fresh recording API, then executes the resulting re-grasp
  - it costs time budget
- Genome knob: `retry.max_regrasp` (0–2). The meta-agent can enable it with a typed patch.
- The night-shift UI must show recover steps.

### F. Richer harness patches
- New patch `add_helper {name, code}`:
  - a pure Python helper function (≤ 40 lines), validated by the same AST sandbox rules
  - stored in the genome and Atlas, injected into the coder's sandbox, and listed in the API doc
  - example: `def safe_grip(kg, give_N)`
- New patch `set_critic_focus {text ≤ 200}`, which steers what the critic writes lessons about.
- New patch `set_tool_cost`? **No.** Tool costs and the time budget stay locked guardrails.
- Update `genome.validate`, `genome.apply`, the meta-agent's system prompt, and the gate.
- Keep "one knob per patch".

## Order of work and acceptance checks
1. **A + B.**
   - `skillsmith oracle` (update it for continuous controls: grid over grip_N × speed) shows every item solvable.
   - The best constant plan scores **≤ 55%**.
   - The no-tool, no-memory baseline (v0) lands at **H 30–55%**.
   - Commit.
2. **C (then D).**
   - The oracle shows every order solvable, with ordering mattering in at least a third of orders.
   - A scripted good plan packs 5 items.
   - A video renders with no instability warnings.
   - Commit.
3. **E.**
   - `demo-kill` still recovers with pixel diff 0.
   - A forced slip triggers a `recover` step that re-grasps.
   - Commit.
4. **F.** Validator unit checks (good patch accepted, locked edit rejected, multi-knob rejected, unsafe helper code
   rejected). Commit.
5. **Web.**
   - Show continuous values (N, m/s), the `ordering` family, recover steps, and 4–6 items in the theater chips and
     the night shift.
   - `npm run build` passes.
   - Verify in the browser against the v2 database.
   - Commit.
6. **Full run.**
   - `seed --reset` on the v2 databases, then `evolve --generations 12 --workers 8`.
   - Run the scripted guardrail checks: a locked edit, and `set_model coder=strong`.
   - Then `final-exam`, `showcase` for v0 and the best version on the story order, `demo-kill`, and `redteam`.
   - Record `replay.json` from the v2 data.
   - Target a staircase of at least 4 kept steps. **Don't tune the gate or suites after seeing results to
     manufacture one.** If the climb is short, report it honestly and suggest why.
7. **Docs.** Update README (task design and an honest-notes section) and DEMO.md (new results table and script) with
   the real numbers. Keep the v1 results as a "previous run" section.

**Cut list if time runs short (cut from the top):** D's extra products → E → F's `set_critic_focus`. Never cut:
A + B, the gate's visible rejections, kill/restart, and real numbers.

## Budget and reporting
- OpenRouter has a $50 cap; v1 spent under $1. A 12-generation v2 run should stay under $5. Check
  `llm_ledger` totals after each generation.
- Report back:
  - what changed, with file references
  - the oracle numbers
  - the generation table (version, patch, verdict, H, T, reason)
  - final exam
  - anything cut or changed from this plan, and why

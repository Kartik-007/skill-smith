# Handoff: the v2 run (3-item orders) and one demoable showcase

You're continuing **Skill Smith** (MongoDB hackathon, SF, 2026-10-11) in `~/Developer/skill-smith`, branch `main`.
Your job is to **run** the v2 harness that's already built, not to change the task. In parallel, another session
builds stacking and bigger orders on branch `v2-stacking` (worktree `~/Developer/skill-smith-stacking`, databases
`skillsmith_v3` / `skillsmith_truth_v3`), and the user is redesigning the frontend.

Read first:
1. this file
2. `docs/SESSION_HANDOFF.md` sections 2 (environment), 3 (code map) and 6 (gotchas). Its results table is v1.
3. `DEMO.md` (v1 runbook)

## What's on `main` (commit `90a82e7`, "v2 M1")
The task is v1 made harder so that memory lookup alone stops working:
- **Hidden per-order conditions** (`truth.py`): every item is `dry`, `wet` (friction x0.4, canisters and bottles),
  `damaged` (crush limit x0.6), `overfilled` (mass x1.3), `half_empty` (mass x0.5, lower centre of mass) or
  `shifted_contents`.
  - The description gives the condition away only some of the time: wet 50%, others 30%.
  - Crush limit = class strength per kg x nominal product mass (`catalog.MATERIALS`).
- **Continuous controls:** `api.pick(id, grip_N, speed_mps)`, with grip 2-45 N per finger and speed 0.1-1.0 m/s.
  - The API doc has a "gripper datasheet" line: grip >= k x mass / friction, with k ~6-11 by speed.
- **Noisy numeric tools** (each costs 3 s of budget, off in v0):
  - `weigh` -> kg +/-12%
  - `squeeze_test` -> N +/-25%
  - `surface_check` -> dry/damp, 10% wrong
- **Skills** are keyed by product x condition and merge into numeric ranges. The condition comes from the referee's
  after-pack inspection: a label only, never numbers.
- **Orders:** 3 items, 3 slots, 18 s budget. Suites T 8, H 6, F 3, plus STORY (cupcakes, Nesquik, cereal).
- **Measured before the run:**
  - Oracle (`core/out/oracle_m1.log`): 51/51 items solvable, 17/17 orders solvable within budget, best constant plan
    52.9% (4.5-5.5 N at 0.5 m/s).
  - v0 probe (no tools, no memory, in-process, 1 repeat): H 28% and 44% across two probes, T 58-62%. One probe is
    noisy (+/-10 pts on 18 items); the real v0 comes from the run.
- **Do not include** the 9 extra products or the stacking code. Both are parked in `docs/parked/` and live on
  `v2-stacking`.

## Rules
- **Data:**
  - Work only in `skillsmith_v2` / `skillsmith_truth_v2`. `.env.local` already points there; `web/.env.local` is a
    symlink to it, so the screen reads your run.
  - Never touch `skillsmith` (recorded v1), `skillsmith_v3`, the `v2-stacking` branch, or the worktree.
- **Secrets:** they live in `.env.local`. Never print, log or commit key values.
- **Honesty:**
  - Don't tune the gate, suites, truth or physics after seeing results.
  - Scripted patches go through `skillsmith force` and are labelled "Guardrail test (scripted)".
  - Put only real numbers in the docs. If the climb is short, say so and suggest why.
- **Web:** don't edit `web/src` (the user and a frontend session own it). Write the replay to
  `web/public/replay_v2.json`, and ask the user before replacing `web/public/replay.json`. `replay_v1.json` is the v1
  fallback.
- **Out of scope:** `docs/PROMPT_META_RAINDROP_TOOLS.md` is a separate, untracked task. Don't implement it here.
- **Commits:** small, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push with
  `git push origin main`. Don't commit `IMG_0349.HEIC` or the untracked prompt file.
- **Shared CPU:** the stacking session caps its physics jobs at 3 processes. Use `--workers 7` for evolve so both
  fit on 11 cores.

## Steps
All commands run from `core/`. Use `.venv/bin/python -m skillsmith.cli ...` when you need a real PID; `uv run
skillsmith ...` is equivalent.

1. **Pre-flight.**
   - Run `.venv/bin/python -m compileall -q skillsmith`.
   - `skillsmith_v2` holds smoke-test leftovers (a fake v0 doc and one T01 run); the reseed wipes them.
2. **Seed.** Run `uv run skillsmith seed --reset`. It wipes only the v2 databases, makes 1 Voyage call and starts a
   new Raindrop epoch. Expect "seeded 14 products, 18 orders, 54 hidden truth docs".
3. **Baseline plus one generation first.** Check the plumbing before committing hours:
   ```bash
   nohup .venv/bin/python -m skillsmith.cli evolve --generations 1 --workers 7 > out/evolve_v2.log 2>&1 &
   ```
   - Check `uv run skillsmith status` and the feed in Atlas.
   - Check that runs have `actions[].grip_N`, `speed_mps` and `items[].inspected`.
   - Check that skills look like "...: packed clean with grip 4-5 N per finger at 0.35-0.5 m/s (3 clean packs)".
   - Check that critic lessons mention conditions.
   - Note the wall time per generation and the spend (step 5).
4. **The rest of the climb.** Run the same command with `--generations 11`; it resumes from Atlas, so a crash just
   means re-running it.
   - Target about 12 generations total. If generations are slow and time is short, stop at 8 and say so.
   - **Process gotcha:** workers are `multiprocessing.spawn` children. To stop, kill the evolve PID and the
     `multiprocessing.spawn` children, or orphans run old code and steal steps. Never use
     `until ! pgrep -f "skillsmith evolve"` (it matches its own shell).
5. **Spend check after each generation:**
   ```bash
   .venv/bin/python -c "from skillsmith import db; print(list(db.db().llm_ledger.aggregate([{'\$group': {'_id': None, 'usd': {'\$sum': '\$cost_usd'}, 'n': {'\$sum': 1}}}])))"
   ```
   The OpenRouter cap is $50 and about $0.7 has been used so far. The whole run should stay under ~$5.
6. **Guardrail checks (scripted, after the climb):**
   ```bash
   uv run skillsmith force '{"op":"set_default","args":{"time_budget_s":30}}' --rationale "Guardrail test: try to loosen the time budget" --workers 7
   uv run skillsmith force '{"op":"set_model","args":{"role":"coder","tier":"strong"}}' --rationale "Guardrail test: buy a stronger coder" --workers 7
   ```
   Expect the first to be rejected by the validator (locked field) and the second to be rejected by the cost guard
   (> 2x per order). Report what actually happens.
7. **Final exam:** `uv run skillsmith final-exam --workers 7` (v0 vs best on F).
8. **Showcase videos:** `uv run skillsmith showcase --version 0`, then `uv run skillsmith showcase` (best version).
   Both use the STORY order. Look at a contact sheet of each video before claiming anything, for example:
   ```bash
   ffmpeg -i ../web/public/videos/<file>.mp4 -vf "select='not(mod(n\,36))',scale=400:-1,tile=5x4" -frames:v 1 sheet.png
   ```
9. **Durability:** `uv run skillsmith demo-kill`. Expect "Recovered ... pixel diff 0".
10. **Red-team:** `uv run skillsmith redteam`. Expect code 13 from Atlas. `harness_app` is already verified on the
    v2 databases: it reads `skillsmith_v2`, and Atlas refuses it on `skillsmith_truth_v2` with code 13.
11. **Replay:**
    - Start the screen with `cd ../web && npm run dev -- -p 3010`, or `preview_start` with `skill-smith-web`. Only
      start it if the frontend session isn't already serving on that port.
    - Record with `npm run record-replay -- 90 http://localhost:3010/api/state public/replay_v2.json`.
12. **Docs:**
    - **DEMO.md:** add a "v2 run" results table (version, patch, verdict, H, T, reason), the final exam and the story
      outcome. Keep the v1 table as "Previous run (v1)".
    - **README.md:** in "The task" and "Honest notes", describe the v2 task. Include these assumptions:
      - crush limit proportional to nominal mass;
      - damaged x0.6 instead of the planned x0.5, because x0.5 left damaged items with a one-point grip window at 0.15-0.25 m/s, which
        no 18 s budget fits;
      - the gripper-datasheet line in the API doc (without it, v0 scored H 6%);
      - skills record the inspection label.
    - Commit and push.

## Known behaviour (so you don't chase it)
- **Cascades:** a wet canister that slips can fall beside the next item, and the hand then lands on both. The
  neighbour gets a large "crush" peak. That's real cascade damage, not a referee bug.
- **The coder often calls `report_gap`** asking about condensation, mass or fragility. Those gaps feed Raindrop
  `capability_gap` and the meta-agent's context, which is intended. Enabling tools should be one of the meta-agent's
  obvious moves.
- **Expected patch types:** `enable_tool` (`surface_check`, `squeeze_test`, `weigh`), `set_retrieval`, `add_rule`,
  `set_default speed_mps`, `set_retry`. The gate's cycle-time guard (+20%) can reject tool-heavy patches, since each
  tool call costs 3 s of an 18 s budget. That's a real trade-off; report it as it falls.
- **A "lease lost" line** is printed only for real takeovers. A heartbeat race after a commit was fixed in M1.

## Report back to the user
- the generation table (version, patch, verdict, H, T, reason), plus v0 and best final exam numbers
- the story video paths for v0 and best, and what happens in each
- the demo-kill recovery line, the red-team result, total LLM spend
- anything that broke, was cut, or looked suspicious

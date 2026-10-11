# Skill Smith: session handoff (2026-10-11, MongoDB hackathon SF)

Written at the end of session 1 so a fresh chat can continue. Read this first, then `README.md`, `DEMO.md`, and
`docs/NEXT_AGENT_PROMPT.md` (the user's plan for v2). The user's answers from session 1 are at the bottom.

## 1. Where things stand
- **Repo:** `~/Developer/skill-smith`, public at https://github.com/Kartik-007/skill-smith. Branch `main`, pushed and
  in sync. The user created the remote. Push after each milestone with `git push origin main`.
- **Working end to end (v1, recorded in Atlas):**
  - MuJoCo Panda packs 3 scanned snacks.
  - LLM coder writes the program, and the deterministic referee grades it with hidden physics.
  - Memory lives in Atlas Vector Search.
  - Meta-agent proposes one typed patch, and the gate decides.
  - Durable Atlas queue with kill -9 recovery (pixel diff 0).
  - Raindrop write and read-back.
  - Next.js screen with a judge form and a replay fallback.
- **What the user wants next:**
  1. Make the task harder and the harness richer, per `docs/NEXT_AGENT_PROMPT.md` (changes A–F, in new databases).
  2. Then a **frontend revamp**. The user said the current screen is "too much to consume". They want it to show
     exactly what is happening, look more impressive, and be easy to follow. They'll define the demo UI. **Don't
     start the UI before asking.**
  3. The 1-minute submission video is on hold until the UI is redone.

## 2. Environment and secrets
- `.env.local` at the repo root (gitignored, `chmod 600`). `web/.env.local` is a symlink to it. **Never print or
  commit values.** Key names:
  - `MONGODB_URI`: admin user `kartikmehra919_db_user` (atlasAdmin; can't create DB users)
  - `MONGODB_URI_HARNESS`: user `harness_app`, readWrite on `skillsmith` only. The user fixed its privileges.
    Atlas now refuses it on `skillsmith_truth` with code 13 (verified with `skillsmith redteam`).
  - `MONGODB_DB=skillsmith`, `MONGODB_TRUTH_DB=skillsmith_truth`. For v2, use `skillsmith_v2` /
    `skillsmith_truth_v2`. **Note:** `harness_app` only has privileges on `skillsmith`. For v2, ask the user to add
    `readWrite` on `skillsmith_v2`. Otherwise `db.harness_client()` probes the login, sees it can't read the v2 db,
    and its code-13 check needs care. Read `db.harness_client` and `db.agent_query` before switching.
  - `OPENROUTER_API_KEY`: $50 cap. **$0.68 used so far.**
  - `VOYAGE_API_KEY`: free tier, about 3 requests/min, so batch everything.
  - `RAINDROP_WRITE_KEY`, `RAINDROP_QUERY_API_KEY`: both work.
  - `CODER_MODEL=anthropic/claude-haiku-5.5`, `STRONG_MODEL=anthropic/claude-sonnet-5.5`
- **Atlas:** cluster `cluster0.sm5irx`, MongoDB 8.0.34. The network allow-list is 0.0.0.0/0. Vector Search and
  transactions work. Automated Embedding exists but we don't use it: Voyage is called directly, and Atlas autoEmbed
  supports only voyage-4 models.
- **Tools:** uv 0.7.8, Python 3.12 (`core/.venv`), node 22, ffmpeg, gh (logged in as Kartik-007). No mongosh;
  use pymongo.
- **Browser preview:** `~/Developer/.claude/launch.json` has `skill-smith-web` (port 3010). Use `preview_start`
  with that name. The `web` name there resolves to a *different* project (agent-evolve).

## 3. Code map (`core/skillsmith/`)
| File | What it does |
|---|---|
| `config.py` | paths, `.env.local` loading, model ids |
| `catalog.py` | 14 products: label, description, class, mass, split (train / heldout / final); `MATERIALS` crush and friction per class; `bbox()` from the OBJ |
| `scene.py` | MJCF world: table at z = 0.40, Panda (gravcomp), green tote with 3 lanes (`SLOTS` S1–S3, 15 cm apart), `STAGING` (3 positions); products = textured mesh + box proxy |
| `control.py` | `Robot`: DLS IK on a separate MjData, min-jerk moves, force-controlled gripper (`GRIP_FORCE`, 0.15 s ramp), `pick` / `place` (grasp `GRASP_DEPTH` below the top) |
| `referee.py` | `Monitor` observer: finger-force EMA peak, slip while held, collisions; `judge_item` returns the first failing family |
| `executor.py` | `OrderSim`: one item per call, `snapshot()` / `restore()` with `mjSTATE_INTEGRATION`, plus monitor and control state |
| `truth.py` | deterministic hidden truth per order item (mass, friction, crush limit, condition, CoM, noise seed) |
| `skill_api.py` | API doc for the coder, `RecordingAPI` (noisy bucketed tools), AST sandbox `run_program` |
| `suites.py` | fixed suites: T (8 orders), H (6), F (3), STORY; `TIME_BUDGET_S = 18` |
| `pipeline.py` | `scene_spec`, `order_view`, `record_plan`, in-process `execute` (used by the oracle) |
| `db.py` | one client; `truth_db(caller)` code guard; `harness_client()` (verified restricted login); `agent_query`; `feed`; `ensure_indexes` |
| `queue.py` | `enqueue_batch` (`plan`, `place`×3, `verify` chained via `waiting_on`), atomic `claim` with lease, `Heartbeat`, transactional `commit` with lease-token check |
| `worker.py` | `do_plan` (LLM ledger `call_key`, retrieval), `do_place` (restore checkpoint, run, judge, render if `render`), `do_verify` (Raindrop, skills, stitch video), `loop`, `_give_up` |
| `memory.py` | Voyage `embed`, `add_many`, `embed_pending`, cached `product_vector`, `$vectorSearch` (`memory_vector` index, filters kind / active / family / class) |
| `agents/coder.py`, `critic.py`, `meta.py` | prompts; meta does at most one optional read query, then one patch JSON (`_parse` handles nesting); `max_tokens` 3000–4000 |
| `genome.py` | `V0`, patch whitelist, `validate` (one knob per patch, locked fields), `apply`, `describe` |
| `gate.py` | `summarize`, paired bootstrap `p_better`, `decide` (keep if T up with P ≥ 0.8, H not down, no family regression > 1, cycle ≤ +20%, cost ≤ 2×) |
| `evolve.py` | `ensure_baseline`, `generation` (durable via `harness_versions.status`), `wait_batch` (restarts dead workers), `run_critic`, `_signals` (Raindrop Query API, falling back to Atlas), `family_rates` (aggregation) |
| `observe.py` | Raindrop `report_run` (event + per-item signals + `capability_gap`), `report_generation`, `query_signals`, `epoch()` |
| `oracle.py` | no-LLM grid over grip × speed |
| `render.py` | `Renderer` (tints), `Recorder` (mp4 via imageio), `CAMERAS["hero"]` |
| `cli.py` | commands below |

**CLI** (`cd core && uv run skillsmith …`; use `.venv/bin/python -m skillsmith.cli …` when you need a real PID to
kill):
- `seed [--reset]`: wipes **only** the configured DBs, inserts products, orders and truth, product embeddings
  (1 Voyage call), indexes, vector index and a new `meta.epoch`.
- `evolve --generations N --workers 8`
- `force '<patch json>' --rationale …`: scripted patch through the same gate, labelled "Guardrail test (scripted)".
- `final-exam`: F suite, v0 vs best; writes `scores.F`.
- `showcase --version V`: renders the STORY order into `web/public/videos/`.
- `demo-kill`: renders STORY, `kill -9` at step 2, waits for the lease (8 s demo lease), restarts, prints the
  recovery and pixel diff.
- `live [--once]`: turns web `live_requests` into orders packed by the best version.
- `redteam`: a meta-agent told to read `skillsmith_truth`; logs a tripwire.
- `raindrop-backfill`: re-sends runs and generations under the current epoch.
- `status`, `oracle`

**Web** (`web/`, Next.js 15): `src/lib/state.ts` builds `/api/state` (polled every 1 s); `src/components/{Theater,
HillClimb, NightShift, Feed}.tsx`; `api/live-order` (the only write); `api/media/[...path]` serves videos and frames
written after start; `?replay=1` plays `public/replay.json`; `npm run record-replay -- <sec> <url> <out>`.

## 4. Data model (db `skillsmith`)
- `products`: visible fields plus `embedding`.
- `orders`: `_id` T01…, H01…, F01…, STORY, `LIVE-*`; with `items[{id, product_id}]`, `time_budget_s`, `seed`.
- `harness_versions`: `version`, `parent`, `status` (evaluating / baseline / kept / rolled_back / rejected),
  `genome`, `patch`, `patch_text`, `rationale`, `meta{model, cost, query}`, `scores{T, H, F, by_family, cycle_s,
  cost_usd, p_better, delta_T, delta_H}`, `batch_id` gNN.
- `work_queue`: `_id` = `{batch}:{order}:v{V}:r{R}:{step}`; `kind`, `waiting_on`, `status`, `lease{owner, token,
  expires_at}`, `attempts`, `render`.
- `runs`: `_id` = order_run_id; `plan_code`, `actions[{item, grip, speed, slot}]`, `tool_calls`, `gaps`,
  `items[{id, ok, family, detail, peak_N, tilt_deg, label, product_id}]`, `damage_free`, `cycle_s`, `cost_usd`
  (nominal), `spent_usd`, `call_key`, `video`, `clips`.
- `checkpoints`: `_id` = `{order_run_id}:{step}`, `snapshot{state, control, motion_time, tool_time, monitor}`,
  `frame`.
- `llm_ledger`: unique `call_key`; replays are free.
- `memory`: lessons and skills (`needs_embed` until batched).
- `feed`, `batches` (kind eval / showcase / live), `live_requests`, `meta` (epoch).
- `skillsmith_truth.scene_truth`: referee path only.

## 5. Recorded v1 results (keep as the fallback demo; numbers are real)
| v | patch | verdict | H | T |
|---|---|---|---|---|
| 0 | baseline | baseline | 75.0 | 29.2 |
| 1 | `set_retrieval skills_k=3` | **kept** | 83.3 | 77.1 |
| 2 | `set_retrieval lessons_k=2` | **kept** | 88.9 | 95.8 |
| 3 | `carry_height_mm=190` | rolled back | 91.7 | 91.7 |
| 4 | `add_rule` (motion) | rolled back | 77.8 | 97.9 |
| 5 | `lessons_k=3` | rolled back | 86.1 | 93.8 |
| 6 | `add_rule` (grip matching) | rolled back | 86.1 | 95.8 |
| 7 | `skills_k=4` | rolled back | 80.6 | 87.5 |
| 8 | `min_score=0.8` | rolled back | 77.8 | 93.8 |
| 9 | `time_budget_s=30` (scripted) | rejected (locked) | | |
| 10 | `set_model coder=strong` (scripted) | rejected (cost guard 16.7×) | 72.2 | 97.9 |
| 11 | `set_retry max_retries=1` (meta, using Raindrop read-back) | rolled back | 77.8 | 95.8 |

Final exam (F): v0 77.8% → v2 100%. STORY: v0 0/3 (crush, collision, slip) → v2 3/3 in 16.8 s. Oracle: 51/51
items solvable; best constant plan 76%.

**Why v2 of the task is needed:** after two retrieval patches the task saturates. Memory lookup solves it, so later
patches can't win. `docs/NEXT_AGENT_PROMPT.md` fixes this (per-order hidden conditions, continuous controls with
numeric noisy tools, stacking, 4–6 items, mid-order recovery, helper and critic-focus patches).

## 6. Hard-won facts and gotchas
- **Physics:**
  - The hand is about 20 cm wide along the finger axis, so neighbours need about 15 cm of spacing.
  - Fingers are about 5 cm long, so items are grasped 2.5 cm below their top.
  - Arm bodies have `gravcomp=1`.
  - The gripper open command is `ctrl = half_width * 100 / OPEN_GAIN`. Closing is force mode via
    `actuator_biasprm[7,0]` with a ramp.
  - Grip forces per finger: soft about 5 N, medium 11, firm 22, max 47.
  - Torsional friction 0.006.
  - The world XML needs `<compiler angle="radian"/>`.
  - Motion time per item: slow 11.8 s, normal 6.2 s, fast 4.1 s.
- **Checkpoint frames:** call `mj_forward` before rendering, or the restored frame differs by about 5k pixels.
- **macOS processes:** worker children are `multiprocessing.spawn`, so `pkill -f "skillsmith evolve"` misses them.
  Orphans run *old code* and steal steps. Kill by PID, or by matching `multiprocessing.spawn`. Never wait with
  `until ! pgrep -f "skillsmith evolve"`, because it matches its own shell.
- **Voyage:** free tier, so you get 429s. Product vectors are cached at seed. Skills are embedded in one batch per
  generation. Critic lessons are added with one `add_many` call. On 429, back off about 21 s.
- **OpenRouter:**
  - Sonnet spends tokens on reasoning, so a small `max_tokens` gives empty content. That's why v3 and v4 of the
    first run failed to parse.
  - Ledger replays must carry the nominal cost, or the cost guard misfires.
- **Raindrop:**
  - Event IDs use `uuid5("skillsmith/{epoch}/{order_run_id}")`. After a DB reset, run IDs repeat, and without the
    epoch Raindrop kept stale events.
  - Query API: `events.count(event_name="pack_order", signal=<signal id from signals.list>,
    properties={"harness_version": "2", "suite": "T", "epoch": "…"})`. Property values must be **strings**. Signal
    names are display-cased ("Crushed").
  - **Fallback:** both read and write are wrapped. Reads fall back to the Atlas mirror and log an info item in the
    feed. Writes use the SDK's bounded retries and timeouts, and errors are swallowed so the night shift never
    breaks.
- **Coder gaps:** Haiku keeps reporting "no orientation control" even though the doc says items are set down
  upright. Harmless, but it's noise in the capability-gap signal.
- **Safety check:** `rm -rf` with globs in `web/public/videos/*` is blocked; leave old media (it's gitignored).

## 7. Demo runbook (current v1)
See `DEMO.md`. Screen: `preview_start skill-smith-web`, or `cd web && npm run dev -- -p 3010`. Packer:
`cd core && uv run skillsmith live`. Durability: `uv run skillsmith demo-kill`. Red-team: `uv run skillsmith
redteam` (now enforced by Atlas).

## 8. User's answers in session 1 (most recent last)
1. "Don't worry about the deadlines, just start." "Allowed 0.0.0.0/0." "Use `kartikmehra919_db_user`, I'm an
   admin." "Yes" to creating the public repo `Kartik-007/skill-smith`. "Those models look good" (Haiku 5.5 coder,
   Sonnet 5.5 critic and meta). Approved the agent plan: one background subagent for `web/`, no Workflow tool, core
   built inline. Confirm before using workflows or dynamic multi-agent orchestration.
2. The user ran `gh repo create … --push` themselves, and it worked.
3. The user created `harness_app`, then fixed its privileges ("this is done"). Atlas now enforces the truth wall.
4. The user provided the Raindrop Query API key ("cool"), and asked: "if we run into raindrop limits, we will fall
   back cleanly, right?" Answer: yes. Reads fall back to Atlas (with a feed note) and write errors are swallowed;
   see section 6.
5. "Wait on the video. A lot of work remaining on revamping the frontend to show exactly what is happening and to
   make it look more impressive and consumable; right now it's too much to consume. For now don't focus on it;
   let's get everything working, then we'll get to the UI which we will demo."
6. "Read this for next steps: `docs/NEXT_AGENT_PROMPT.md`." That's the v2 plan (changes A–F), the next session's
   main work.

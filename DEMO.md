# Demo runbook (3 minutes)

All numbers below come from the recorded run in Atlas (`uv run skillsmith status`).

## Results
| Version | Patch (one knob) | Verdict | Held-out H | Train T | Why |
|---|---|---|---|---|---|
| v0 | baseline harness | baseline | 75.0% | 29.2% | |
| v1 | `set_retrieval skills_k=3` | **kept** | 83.3% | 77.1% | train +47.9 pts, P(better)=1.00 |
| v2 | `set_retrieval lessons_k=2` | **kept** | 88.9% | 95.8% | train +18.8 pts, P(better)=1.00 |
| v3 | `set_default carry_height_mm=190` | rolled back | 91.7% | 91.7% | no gain on train |
| v4 | `add_rule` (motion advice) | rolled back | 77.8% | 97.9% | crush +2.5 items, held-out −13.9 |
| v5 | `set_retrieval lessons_k=3` | rolled back | 86.1% | 93.8% | more lessons → more crushes |
| v6 | `add_rule` (grip matching) | rolled back | 86.1% | 95.8% | no gain |
| v7 | `set_retrieval skills_k=4` | rolled back | 80.6% | 87.5% | crush +2.7, held-out −12.3 |
| v8 | `set_retrieval min_score=0.8` | rolled back | 77.8% | 93.8% | crush +2.2, held-out −12.5 |
| v9 | `set_default time_budget_s=30` (scripted guardrail check) | **rejected** | | | validator: touches a locked guardrail |
| v10 | `set_model coder=strong` (scripted guardrail check) | **rejected** | 72.2% | 97.9% | cost guard: 16.7× per order, and worse on held-out |

**Final exam (never-seen snacks): v0 77.8% → v2 100%.** Story order: v0 0/3 (cupcakes crushed, Nesquik hit the
wall, cereal slipped) → v2 3/3 in 16.8 s of an 18 s budget. Coder spend for the whole night: well under $1.

## Setup before going on stage
```bash
cd web && npm run dev                      # the screen (localhost:3000); ?replay=1 if anything live fails
cd core && uv run skillsmith live          # packs judge requests from the web form
```

## Script
| Time | Say | Show |
|---|---|---|
| 0:00 | "Dev Ittycheria's hackathon snack box. Three snacks, an 18-second budget, hidden physics. Here's harness v0." | Robot theater: v0 video, cupcakes red (crushed), cereal slips |
| 0:20 | "Every failure is a physics fact sent to Raindrop: crushed, slipped. The coder can report its own gaps. The meta-agent reads those signals and proposes one patch. Turn on proven skills from Atlas Vector Search: kept, train 29 → 77." | Feed + chart first step |
| 0:50 | "Six more ideas the gate threw out: more lessons made it timid and crushier, a stronger model cost 16× and was worse on held-out, and a locked guardrail edit was rejected before it ran. The model never changed. Final exam on never-seen snacks: 78 → 100%." | Chart with red ✗ and hover reasons |
| 1:30 | "The night shift is a durable queue in Atlas." Run `uv run skillsmith demo-kill`. "kill -9 mid-item... lease expires... recovered from the checkpoint, pixel diff zero. It picks up exactly where it left off, because its state lives in Atlas, not in the process." | Terminal + night-shift panel with before/after frames |
| 2:15 | "Your turn: type your name, pick a snack." The best harness packs it live. | Judge form → robot theater |
| 2:40 | "The truth database is walled off. We red-teamed it: told the meta-agent to read the hidden physics, and it got not-authorized." | Feed tripwire item |
| 2:50 | "The model didn't get smarter. The harness did, and it never forgot where it was." | |

## 1-minute submission video
0:00–1:30 compressed: v0 failure → Raindrop signals → kept patches + rejections → kill -9 and recovery.

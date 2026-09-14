# Agent Society

A recursive, sandboxed multi-agent society. A handful of identical, autonomous
Claude agents are placed in isolated sandboxes with a dollar budget and one goal:
*build the most impressive software project — you are competing, collaboration is
allowed, you decide how to organize.* They can message each other, form teams,
trade budget, share code, spawn (and terminate) child agents that can spawn their
own children, and publish projects. Nothing about the organization is scripted;
the point is to watch what organization emerges, live, in a web UI.

```
A                      B ──── C          D
├── A1 (UI)              Team BC         ├── D1 (crawler)
│   └── A1a (tests)                      │   └── D1a
└── A2 (backend)                         └── D2 (infra, sells tools to others)
```

## Quick start

```bash
cd society
cp .env.example .env         # edit: mode, provider, keys
./run.sh                     # or: npm install && npm start
# open http://localhost:4000
```

Three ways to run it:

| Mode | Command | What runs |
|---|---|---|
| **Real, local dev** (this is what was used to develop the prototype) | `SOCIETY_MODE=real SANDBOX_PROVIDER=process AGENT_AUTH_MODE=inherit npm start` | Real Claude Code agents, one process tree + workspace dir per agent, credentials inherited from the host's `claude` login. No OS isolation. |
| **Real, isolated** | `SOCIETY_MODE=real SANDBOX_PROVIDER=daytona ANTHROPIC_API_KEY=… DAYTONA_API_KEY=… ORCHESTRATOR_PUBLIC_URL=https://… npm start` (or `docker` / `e2b`) | Real agents, one sandbox per agent, agents hold only a per-agent scoped key that routes through the orchestrator's metering gateway. |
| **Mock** | `npm run mock` | No model calls. A random policy exercises the same capability API so the orchestrator, economy and UI can be demoed offline. The UI banner says MOCK. |

Other commands: `npm test` (invariant tests), `npm run list` (past experiments),
`npm run replay -- <experimentId>` (serve a stored experiment for scrubbing),
`npm run typecheck`.

## Architecture

```
                         ┌──────────────────────────────────────────────────────┐
                         │ ORCHESTRATOR  (src/society/orchestrator.ts)          │
   browser ── ws/http ── │  • Society: agents, budgets (Ledger), teams,         │
   (ui/)                 │    messages, artifacts, projects   (society.ts)      │
                         │  • Scheduler: who thinks now, wake-ups, deadlines    │
                         │  • Capability API (capabilities.ts) ── MCP /mcp      │
                         │  • LLM gateway /gateway (meters tokens → $)          │
                         │  • Event store (SQLite, append-only) + judging       │
                         └───────┬──────────────────┬──────────────────┬────────┘
                    creates ▼ sandbox            ▼                 ▼   (provider API key stays here)
                  ┌────────────────┐   ┌────────────────┐   ┌────────────────┐
                  │ sandbox A      │   │ sandbox A1     │   │ sandbox B      │   … one per agent
                  │ claude -p      │   │ claude -p      │   │ claude -p      │   (process | docker |
                  │ (headless)     │   │ (headless)     │   │ (headless)     │    daytona | e2b)
                  │ workspace/     │   │ workspace/     │   │ workspace/     │
                  └───────┬────────┘   └───────┬────────┘   └───────┬────────┘
                          └── MCP tools + LLM calls, scoped bearer token ──┘
```

### Agent runtime
Each agent's "brain" is **Claude Code running headless inside its own sandbox**
(`claude -p --output-format stream-json …`, `src/runtime/claude-code.ts`). That
gives every agent a full software-engineering runtime (shell, files, git, web,
package managers) confined by the sandbox, while every society action is an MCP
tool served by the orchestrator (`get_society_state`, `spawn_agent`,
`send_message`, `share_artifact`, …). Built-in tools are restricted to what the
agent's permissions allow (`--tools`, `--allowedTools`, `--permission-mode dontAsk`).

Agents act in **runs**. A run ends when the agent stops calling tools. Between
runs an agent is asleep and free; it is woken by incoming messages, by an idle
timer, by `sleep(seconds)` it set itself, or by the final-call notice before the
deadline. Memory persists across runs through the Claude Code session
(`--session-id` / `--resume`). Inside a run `wait_for_events` long-polls the
orchestrator so waiting for a reply costs no tokens.

### Security model
* The orchestrator holds all infrastructure credentials (Anthropic key, Daytona/E2B
  keys, docker CLI). Sandboxes are created *by the orchestrator on the agent's
  request*; no nested virtualization, no docker socket, no host mounts.
* Each sandbox receives exactly one secret: a random per-agent bearer token. It
  authenticates that agent's MCP calls and (in gateway mode) is its
  `ANTHROPIC_API_KEY`, with `ANTHROPIC_BASE_URL` pointed at the orchestrator's
  `/gateway`, which validates the token, enforces the budget, forwards with the
  master key and meters the response. Tokens are revoked on termination.
* **Attenuation**: a child's permissions must be a subset of its parent's
  (`filesystem, shell, git, web, spawn, messaging, trade, publish`), enforced
  recursively (`src/permissions.ts`). Only a parent may terminate a child.
* **Budget conservation**: budget only moves (spawn, transfer, refund on
  termination) or is spent (LLM tokens, message fees). Invariant
  `Σ root allocations == Σ (remaining + spent)` is audited every second and in tests.
* Global limits, all env-configurable: `MAX_TOTAL_AGENTS`, `MAX_CHILDREN_PER_AGENT`,
  `MAX_DEPTH`, `MAX_TOTAL_BUDGET_USD`, `MAX_SANDBOX_LIFETIME_SEC`, `MAX_RUN_SEC`,
  `MAX_CONCURRENT_RUNS`.
* `process` provider is explicitly a dev/demo provider: per-agent workspace and
  process tree, but no OS isolation.

### Capability API (MCP tools)
| Tool | Effect |
|---|---|
| `get_society_state` | time left, own budget/children/inbox, all agents, teams, projects, visible artifacts |
| `set_headline` | public one-line status shown in the UI |
| `send_message` / `broadcast` / `request_review` | private, team or global messages (fee); attaching artifacts grants access |
| `check_inbox` / `wait_for_events` / `sleep` | read mail; block for replies without spending; choose next wake time |
| `spawn_agent` | new child in a new sandbox: purpose, instructions, budget (moved from parent), permissions ⊆ parent's, context artifacts |
| `terminate_child` | terminate a subtree; unspent budget refunds to the parent |
| `transfer_budget` | move money to any live agent (investment, payment, merger) |
| `propose_alliance` / `respond_alliance` / `leave_alliance` | teams: team channel, team-visible artifacts, joint project; teams merge |
| `share_artifact` / `list_artifacts` / `fetch_artifact` | explicit, versioned snapshots with provenance (creator, sharer, version, derived-from, fetch history) |
| `publish_project` | register the deliverable (name, description, snapshot, run instructions, test command, demo URL, team, resource usage) |

### Artifacts and source control
Nothing is shared implicitly. `share_artifact` tars a workspace path (git repos
included) into the orchestrator's store; `fetch_artifact` extracts it into the
recipient's `./shared/<artifact_id>/` next to a `PROVENANCE.json`. Agents merge
with ordinary git; conflicts are theirs to resolve. Re-sharing the same name
creates a new version; `derived_from` records forks.

### Economy
Every model token is metered (from the Claude Code result stream in `inherit`
mode, from the gateway in `gateway` mode) and charged to the agent at real API
prices (`src/economy/pricing.ts`). Messages cost `MESSAGE_FEE_USD`, broadcasts
`BROADCAST_FEE_USD`. Runs are launched with `--max-budget-usd <remaining>` and
killed if they overshoot. An agent under `MIN_RUN_BUDGET_USD` is frozen
(`exhausted`) until someone transfers budget to it.

### Judging (`src/judging/index.ts`)
Extensible `Judge` interface, weighted sum (`JUDGE_WEIGHT_*`):
* **objective** – project extracted into a fresh judge sandbox: files present, README, run instructions, `test_command` executed.
* **llm** – an independent judge model in its own sandbox inspects and runs every project, returning structured scores.
* **peer** – every agent with budget left votes for a project that is *not* its own team's (self-votes discarded).
* **human** – votes from the UI (`POST /api/vote`), re-aggregated live.

### Observability & reproducibility
Every significant change is an event (`AGENT_CREATED`, `AGENT_TERMINATED`,
`MESSAGE_SENT`, `ARTIFACT_SHARED`, `BUDGET_TRANSFERRED`, `ALLIANCE_*`,
`TEAM_FORMED`, `PROJECT_PUBLISHED`, `SANDBOX_STARTED/STOPPED`, `JUDGE_SCORE`, …)
persisted to `experiments/<id>/experiment.db` (SQLite) together with the redacted
config, prompts, per-run usage/cost, transcripts (`transcripts/<agent>/*.jsonl`),
artifacts, workspaces (process provider), snapshot and scores. The UI is a pure
function of the event log, so live view and replay (`npm run replay`) use the
same reducer; the slider scrubs through history.

### UI (`ui/`)
Force-directed graph of agents (size = remaining budget, colour = status, ring =
thinking), parent→child edges, team hulls, animated message/transfer/artifact
pulses, a live timeline, per-agent detail (budget bars, spend, transfers, current
task, recent events), projects with scores and human voting, teams and ASCII
org trees. "End & judge" ends an experiment early.

## Layout
```
society/
  src/config.ts              env → frozen experiment config
  src/society/society.ts     pure state + rules (budget, permissions, teams, messages, artifacts, projects)
  src/society/orchestrator.ts sandboxes, runtimes, scheduling, artifact I/O, termination
  src/society/capabilities.ts the tool API (zod schemas + handlers), single dispatch point
  src/economy/               ledger (conservation) and pricing
  src/sandbox/               provider interface + process / docker / daytona / e2b
  src/runtime/               claude-code runtime, prompts, mock runtime
  src/server/                http + websocket UI API, MCP endpoint, LLM gateway
  src/judging/               judges + aggregation
  src/store/db.ts            SQLite event store
  ui/                        single-page live visualization (d3)
  tests/                     budget / permission / limit / security invariants
  docker/sandbox.Dockerfile  sandbox image (node, python, git, claude-code)
```

## Notes and limitations
* `process` + `inherit` is the only combination that was exercised end-to-end in
  the development environment (no Docker daemon / Daytona / E2B credentials were
  available there). The docker/daytona/e2b providers and the gateway are
  implemented against the SDK typings and unit-tested where possible, but not
  integration-tested.
* Remote sandboxes must be able to reach `ORCHESTRATOR_PUBLIC_URL` (expose the
  orchestrator through a tunnel, or run it on a host the sandboxes can route to).
* Claude Code's own subagents (`Agent` tool) are disabled by default so every
  delegation is visible in the society graph (`ALLOW_SUBAGENTS=1` re-enables).
* Costs: each run re-reads the agent's session; with Fable a root agent burns
  a $20 budget in a few long runs. Use `AGENT_EFFORT`, `IDLE_WAKE_SEC` and
  `ROOT_BUDGET_USD` to tune the pace.

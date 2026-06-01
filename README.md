# Mission Control

A local web dashboard for the parallel AI coding agents you run across git worktrees — **Claude Code
and Codex**, whether they're running in a terminal or in a desktop app. It organises your work the way it
actually lives on disk: **projects** (git repos) and their **worktrees**, with each agent shown in the
slot where it's running. The ones that need you float to the top, and a native macOS notification fires
the moment an agent starts waiting for input or errors.

It works by **watching the session transcript files both tools already write** — no special launcher,
no wrapper, nothing to change in how you start agents:

- Claude → `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`
- Codex → `~/.codex/sessions/**/rollout-*.jsonl`, indexed by `~/.codex/state_5.sqlite`

It only ever **reads** those files (and runs read-only `git`/`gh` for state). The only things it writes
are its own metadata (pins, renames, dismissals, notes, project list) in `~/.missioncontrol/meta.sqlite`.

## Run

```bash
npm install        # once
npm start          # build the UI + serve the app at http://127.0.0.1:4317
```

For development with hot-reload (Vite UI + auto-restarting server):

```bash
npm run dev        # UI on http://127.0.0.1:5173 (proxies /api to :4317)
```

Other scripts: `npm test` (vitest), `npm run typecheck` (tsc). Override the port with `MC_PORT=...`.

## What you see

### Tabs: All + one per project

- **All** — a single glanceable grid of every agent, sorted needs-you-first. This is the triage view.
- **One tab per project** — a project is a git repo (its primary checkout + all linked worktrees).
  Projects are discovered automatically from the repos your agents run in; you can also **+ Add project**
  by path so a repo with no agent yet still appears.

### A project tab = its worktrees, as "slots"

Each worktree is a **slot** — a place for work to happen — shown as a card whether or not an agent is in it:

- **Every slot** shows its path, branch, **commit state (dirty/clean)**, ahead/behind, and the **PR
  status** for its branch (link, CI ✓/✕, merged/conflicts/behind tags) — even when empty.
- **An occupied slot** also shows everything a card shows below, plus, when it's waiting on you, a
  two-line exchange: **You:** the last thing you typed, and **Agent:** what it's asking or reporting — so
  you re-acquire the conversation without opening it.
- **An empty slot** is marked *Available* with a **Start** control: **Claude** opens a new iTerm tab in
  that worktree and runs `claude`; **Codex** raises the Codex app and copies the worktree path to your
  clipboard (the Codex app has no "open a new session in this folder" API).

### The card itself (clarity, not data density)

Each card is an LLM-synthesized answer to "what is this, does it need me, what's next":

- **A short title** and a plain-language summary of the task (synthesized, not the raw prompt).
- **Which need you** — a prominent amber/red banner the moment an agent is blocked on a question, a plan
  to approve, a decision, or an error.
- **Where it is in the workflow** — a 6-step phase stepper: Planning → Execution → Testing →
  Simplification → Code Review → Release. (Simplification and Code Review map to your `code-simplifier`
  and `/code-review` skills.)
- **The clear next step**, the tool's tinted logo (Claude / Codex), and a live "Working / Waiting on you
  / Idle" liveness pill.

**Click a card to jump to the actual agent window** — Claude focuses the exact iTerm tab (matched by the
backing process's tty); Codex deep-links the thread (`codex://threads/<id>`). A separate button opens a
detail drawer with the full activity timeline, latest message, tokens/context %, model, PR section, and
pin/rename/dismiss/notes.

The synthesis is a small **headless `claude -p` call per agent** — it uses your existing Claude auth (no
API key), runs from a dedicated cwd that's filtered out of the board, is cached by content hash in
`meta.sqlite`, and only re-runs when an agent's state changes. Disable with `MC_SYNTH=0`; change the model
with `MC_SYNTH_MODEL=...` (default `sonnet`).

Two principles hold throughout: status is computed from the **main transcript** (a background subagent
never makes a finished session look busy), and liveness is never faked — Codex live = an open file handle
on the rollout; Claude live = recent activity + a matching `claude` process; otherwise we say so.

## Architecture

```
session files on disk ─► collector (chokidar watch + 2s sweep)
                          ├─ adapters/claude.ts, adapters/codex.ts ─► unified AgentRecord map (store)
                          ├─ liveness.ts (cached lsof / ps probes)
                          ├─ git.ts (worktree list, dirty, ahead/behind) + pr.ts (gh, cached)
                          └─ projects.ts ─► project/worktree topology (projectStore)
                                                                     ─► Fastify  GET /api/snapshot
~/.missioncontrol/meta.sqlite ◄─► metadata (pins, notes, projects)             GET /api/events (SSE)
                                                                                POST /api/agents/:id/meta
                                                                                POST /api/agents/:id/focus
                                                                                POST /api/launch
                                                                                POST /api/projects
                                                                     ─► React + Tailwind console UI
```

The agent store and the project topology are **separate stores with separate SSE channels**, each diffed
on its own narrow field set so a per-second agent tick never repaints the board and slots don't flash.
Adding another agent tool later = a new adapter implementing the same `AgentRecord` shape.

## Safety

The launch endpoint runs a shell from a local server, so it is locked down: the server binds loopback
only, foreign-origin POSTs are rejected, and a path is only launchable if it is both under `$HOME` **and**
a worktree the app itself enumerated from git. The collector opens `~/.claude` and `~/.codex` read-only.

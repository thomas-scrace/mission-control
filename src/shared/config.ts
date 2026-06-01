import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();

// Read-only sources (we NEVER write here).
export const CLAUDE_PROJECTS_DIR = path.join(HOME, '.claude', 'projects');
export const CODEX_SESSIONS_DIR = path.join(HOME, '.codex', 'sessions');
export const CODEX_STATE_DB = path.join(HOME, '.codex', 'state_5.sqlite');

// Our own state (the only place we write).
export const MC_DIR = path.join(HOME, '.missioncontrol');
export const META_DB = path.join(MC_DIR, 'meta.sqlite');

export const PORT = Number(process.env.MC_PORT ?? 4317);

// Tuning knobs.
export const HISTORY_LIMIT = 40; // entries kept per agent for the detail view
export const TAIL_BYTES = 512 * 1024; // how much of a transcript tail we read
export const STALE_WINDOW_MS = 24 * 60 * 60 * 1000; // default "active recently" UI window
export const INGEST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // only ingest sessions touched within this
export const SUBAGENT_ACTIVE_MS = 30_000; // a sidechain file modified this recently counts as a live subagent
export const SWEEP_INTERVAL_MS = 2000; // backstop: re-tail live agents, re-evaluate liveness, poll hot PRs
export const GIT_CACHE_MS = 10_000; // cache git toplevel/branch per cwd
export const WORKTREE_LIST_TTL_MS = 15_000; // re-enumerate a project's worktrees this often
export const WORKTREE_GIT_TTL_MS = 8_000; // cache per-slot dirty/ahead-behind (live slots bypass)
export const PROBE_CACHE_MS = 3000; // cache ps/lsof probe results this long
export const SSE_COALESCE_MS = 200; // batch outbound pushes

// ── LLM synthesis (per-agent brief via headless `claude -p`) ──
export const SYNTH_ENABLED = process.env.MC_SYNTH !== '0';
export const SYNTH_MODEL = process.env.MC_SYNTH_MODEL ?? 'sonnet';
export const SYNTH_DIR = path.join(MC_DIR, 'synth'); // cwd for synthesis calls (filtered out of the board)
export const SYNTH_CONCURRENCY = 2; // max concurrent claude -p processes
export const SYNTH_MIN_INTERVAL_MS = 30_000; // min time between syntheses for the same agent
export const SYNTH_TRANSITION_MS = 6_000; // shorter floor when the agent's status just changed (snappy at transitions)
export const SYNTH_FRESH_MS = 6 * 60 * 60 * 1000; // only synthesize agents live or active within this

// ── GitHub PR enrichment (via `gh`) ──
export const PR_ENABLED = process.env.MC_PR !== '0';
export const PR_TTL_MS = 90_000; // cold: non-live agents (PR rarely changes)
export const PR_TTL_LIVE_MS = 10_000; // a live agent's PR
export const PR_TTL_HOT_MS = 4_000; // a live agent actively doing PR/release work — near-realtime
export const PR_CONCURRENCY = 3; // max concurrent `gh` calls

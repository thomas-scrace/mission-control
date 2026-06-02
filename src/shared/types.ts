// The unified data model. One AgentRecord per *real* session (sidechains folded in).
// This is the contract shared by the collector, the server, and the web UI.

export type Tool = 'claude' | 'codex';

export type Runtime = 'terminal' | 'app' | 'ide' | 'unknown';

/**
 * What the agent is doing right now, derived from the tail of its transcript.
 * Sort priority for the board is: waiting > error > busy > idle > done > unknown.
 */
export type AgentStatus = 'waiting' | 'error' | 'busy' | 'idle' | 'done' | 'unknown';

/**
 * Whether the session is currently a live process. Kept SEPARATE from status
 * because we often know what the last action was but cannot prove the agent is
 * still open. We never fake certainty — `livenessBasis` always explains the call.
 */
export type Liveness = 'live' | 'idle' | 'ended' | 'unknown';

/** The 6-stage workflow each agent moves through. Simplification + code-review map to the
 *  user's specific skills (code-simplifier, /code-review). */
export type Phase = 'planning' | 'execution' | 'testing' | 'simplification' | 'code-review' | 'release';

export const PHASES: Phase[] = ['planning', 'execution', 'testing', 'simplification', 'code-review', 'release'];

export const PHASE_LABELS: Record<Phase, string> = {
  planning: 'Planning',
  execution: 'Execution',
  testing: 'Testing',
  simplification: 'Simplification',
  'code-review': 'Code Review',
  release: 'Release',
};

/** An LLM-synthesized, human-readable brief for one agent — the heart of the card UI. */
export interface AgentBrief {
  title: string; // a SHORT 1-4 word name for the task — the card hero
  summary: string; // the overall project/task, one plain-language line (shown in the drawer)
  phase: Phase | null;
  needsYou: boolean; // is the agent blocked, needing you right now
  needsReason: string | null; // if so, what it needs
  lastAsk: string | null; // the last thing you asked it to do
  nextStep: string | null; // the clear next action
  simplified: boolean; // has a code-simplifier pass been run on the latest batch of work
  reviewed: boolean; // has a /code-review pass been run on the latest batch of work
  at: number; // epoch ms when synthesized
  state: 'pending' | 'ready' | 'error';
}

export type CiStatus = 'passing' | 'failing' | 'pending' | 'none';

/** GitHub PR state for an agent's branch, via the `gh` CLI. */
export interface PullRequest {
  number: number;
  url: string;
  title: string;
  state: string; // OPEN | MERGED | CLOSED
  isDraft: boolean;
  baseRef: string; // base branch (e.g. master)
  conflicts: boolean; // not mergeable / has conflicts
  behindBase: boolean; // branch is behind its base (not up to date)
  mergeStateStatus: string; // raw: CLEAN | BEHIND | DIRTY | BLOCKED | UNSTABLE | …
  ci: CiStatus;
  checksTotal: number;
  checksFailing: number;
  at: number; // epoch ms when fetched
}

export type HistoryKind =
  | 'tool'
  | 'message'
  | 'plan'
  | 'pr'
  | 'system'
  | 'subagent'
  | 'compaction'
  | 'user';

export interface HistoryEntry {
  ts: number; // epoch ms
  kind: HistoryKind;
  label: string;
}

export interface AgentRecord {
  // identity
  id: string; // claude: sessionId (== .jsonl filename); codex: thread UUID
  tool: Tool;
  runtime: Runtime;

  // location
  cwd: string;
  worktree: string; // basename(cwd) — the human label
  branch: string | null;

  // the headline
  job: string; // aiTitle / threads.title / first prompt — what this agent is FOR

  // current state
  status: AgentStatus;
  statusDetail: string | null; // e.g. in-flight tool name, or the question being asked
  liveness: Liveness;
  livenessBasis: string; // "open file handle" | "mtime 8s + claude@cwd" | "no process, mtime 41m"

  // activity
  lastAction: string | null; // last tool call rendered name+target
  lastMessage: string | null; // last assistant prose (excluding thinking)
  lastUserPrompt: string | null; // raw text of the user's most recent message (excl. tool_result)
  history: HistoryEntry[]; // most-recent-last, capped

  // metrics
  tokens: number | null; // most recent context occupancy (raw)
  contextWindow: number | null; // model context window if known
  model: string | null;
  subagentsActive: number | null; // Claude: count of live background subagents; null for Codex

  // timing (all epoch ms)
  idleSec: number | null;
  startedAt: number | null;
  updatedAt: number; // last activity we can see

  // extras (null where a tool can't supply them — the UI hides nulls, never fakes)
  prLink: string | null;
  permissionMode: string | null;

  // synthesized brief (LLM) — null until first synthesis completes
  brief: AgentBrief | null;

  // GitHub PR for this branch (via gh) — null if none / not fetched yet
  pr: PullRequest | null;

  // debugging / soft-fail
  sourceFile: string; // transcript path
  rawTail: string | null; // last raw line, shown if structured parse failed

  // user metadata (merged from the meta store; never sourced from the agent files)
  pinned: boolean;
  jobName: string | null; // user override for `job`
  dismissed: boolean;
  notes: string | null;
  order: number; // stable display position (ascending); user-draggable, persisted
}

/**
 * A lightweight pointer from a worktree slot to its occupying agent — NOT the
 * whole AgentRecord (which the UI joins by id). Carries just enough to render
 * the slot's occupancy headline and tone without a join.
 */
export interface SlotAgentRef {
  id: string;
  tool: Tool;
  status: AgentStatus;
  liveness: Liveness;
  job: string;
  needsYou: boolean;
}

/** One git worktree = one "slot". Present even when no agent occupies it. */
export interface WorktreeSlot {
  path: string; // absolute worktree path (also the slot id within a project)
  branch: string | null; // null = detached HEAD
  isPrimary: boolean; // the main checkout (first entry of `git worktree list`)
  exists: boolean; // false if git lists it but the dir is gone (prunable)
  detached: boolean;
  bare: boolean;
  // git working-tree state (cached) — null while never-yet-probed / not applicable
  dirty: boolean | null; // `git status --porcelain` non-empty
  ahead: number | null; // commits ahead of upstream; null when no upstream
  behind: number | null;
  // PR for this slot's branch — null if none / not fetched yet
  pr: PullRequest | null;
  // occupancy
  agent: SlotAgentRef | null; // the winning agent (live wins, else most-recent), or null = empty
  sessionsCount: number; // how many agents map to this worktree
}

/** A git repo grouped by its common .git dir: one primary checkout + N worktrees. */
export interface Project {
  id: string; // stable: realpath of the git-common-dir
  name: string; // basename of the primary checkout path
  root: string; // absolute path of the PRIMARY checkout
  slots: WorktreeSlot[]; // primary first, then linked, stable thereafter
  origin: 'discovered' | 'manual';
  at: number; // epoch ms when this topology was last computed
}

/** Messages pushed to the browser over SSE. */
export type ServerEvent =
  | { type: 'snapshot'; agents: AgentRecord[]; projects: Project[]; serverTime: number }
  | { type: 'upsert'; agent: AgentRecord; serverTime: number }
  | { type: 'remove'; id: string; serverTime: number }
  | { type: 'project-upsert'; project: Project; serverTime: number }
  | { type: 'project-remove'; id: string; serverTime: number };

/** Persisted project metadata (manual adds / hides) in meta.sqlite. */
export interface ProjectMetaRow {
  id: string; // realpath(common-dir), or the user-entered path before it groups
  path: string; // absolute path the user added (the primary checkout)
  name: string | null;
  origin: 'manual' | 'discovered';
  hidden: boolean;
}

/** User metadata persisted in ~/.missioncontrol/meta.sqlite, keyed by agent id. */
export interface AgentMeta {
  id: string;
  pinned: boolean;
  jobName: string | null;
  dismissed: boolean;
  notes: string | null;
  order: number | null;
}

export const STATUS_SORT: Record<AgentStatus, number> = {
  waiting: 0,
  error: 1,
  busy: 2,
  idle: 3,
  done: 4,
  unknown: 5,
};

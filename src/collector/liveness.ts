import { run } from './sh';
import { humanizeAgo, idleSeconds } from './time';
import { PROBE_CACHE_MS } from '../shared/config';
import type { AgentRecord, Liveness } from '../shared/types';

const LIVE_RECENT_MS = 120_000; // 2 min — "actively producing output"
const IDLE_RECENT_MS = 15 * 60_000; // 15 min — "recently active, probably still open"

export interface ClaudeProc {
  pid: number;
  tty: string | null; // e.g. "ttys012" — lets us focus the exact iTerm tab
  cwd: string | null;
}

function isClaudeAgentCmd(cmd: string): boolean {
  // The Claude Code CLI (node) shows as a `claude ...` command. Exclude the desktop
  // app (`.app/`), `claude mcp` helpers, and our own headless `claude -p` synthesis calls.
  return (
    /(^|\/)claude(\s|$)/.test(cmd) &&
    !cmd.includes('.app/') &&
    !/\bclaude\s+mcp\b/.test(cmd) &&
    !/\s-p(\s|$)/.test(cmd) &&
    !cmd.includes('--print')
  );
}

let claudeCache: { t: number; procs: ClaudeProc[] } | null = null;
let codexCache: { t: number; handles: Set<string> } | null = null;

/** Live `claude` CLI agent processes + their working directory (via lsof -d cwd). */
export async function getClaudeProcesses(now = Date.now()): Promise<ClaudeProc[]> {
  if (claudeCache && now - claudeCache.t < PROBE_CACHE_MS) return claudeCache.procs;
  const ps = await run('ps -axo pid=,tty=,command=');
  const procs: ClaudeProc[] = [];
  for (const line of ps.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const cmd = m[3]!;
    if (isClaudeAgentCmd(cmd)) {
      const tty = m[2] === '??' ? null : m[2]!;
      procs.push({ pid: Number(m[1]), tty, cwd: null });
    }
  }
  const pids = procs.map((p) => p.pid);
  if (pids.length) {
    const lsof = await run(`lsof -a -p ${pids.join(',')} -d cwd -Fpn 2>/dev/null`);
    const cwdByPid = new Map<number, string>();
    let cur: number | null = null;
    for (const line of lsof.split('\n')) {
      if (line.startsWith('p')) cur = Number(line.slice(1));
      else if (line.startsWith('n') && cur != null) cwdByPid.set(cur, line.slice(1));
    }
    for (const p of procs) p.cwd = cwdByPid.get(p.pid) ?? null;
  }
  claudeCache = { t: now, procs };
  return procs;
}

/** Set of Codex rollout files currently held open (write handle) — the focused thread(s). */
export async function getCodexHandles(now = Date.now()): Promise<Set<string>> {
  if (codexCache && now - codexCache.t < PROBE_CACHE_MS) return codexCache.handles;
  const out = await run('lsof -c codex -c Codex -Fn 2>/dev/null');
  const handles = new Set<string>();
  for (const line of out.split('\n')) {
    if (line.startsWith('n')) {
      const p = line.slice(1);
      if (p.includes('rollout-') && p.endsWith('.jsonl')) handles.add(p);
    }
  }
  codexCache = { t: now, handles };
  return handles;
}

/** True when path `a` is `b` itself or nested inside `b`. */
export function within(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const base = b.endsWith('/') ? b : b + '/';
  return a.startsWith(base);
}

/** The live `claude` process most likely backing this agent (by working directory). */
export function findClaudeProc(agentCwd: string, procs: ClaudeProc[], top: string | null = null): ClaudeProc | null {
  return procs.find((p) => p.cwd != null && cwdMatch(p.cwd, agentCwd, top)) ?? null;
}

function cwdMatch(procCwd: string, agentCwd: string, top: string | null): boolean {
  if (procCwd === agentCwd) return true;
  if (top && within(procCwd, top)) return true;
  return within(procCwd, agentCwd) || within(agentCwd, procCwd);
}

export function classifyClaudeLiveness(
  agent: AgentRecord,
  procs: ClaudeProc[],
  gitTop: string | null,
  now = Date.now(),
): { liveness: Liveness; livenessBasis: string } {
  const recencyMs = now - agent.updatedAt;
  const ago = humanizeAgo(idleSeconds(agent.updatedAt, now));
  const matched = findClaudeProc(agent.cwd, procs, gitTop) != null;
  const anyAlive = procs.length > 0;

  // An agent blocked on YOUR input is a live, open session even though its transcript hasn't
  // changed since it asked — don't let it decay to "idle". Require a claude process in its
  // worktree so we never resurrect a session whose terminal was closed.
  if (agent.status === 'waiting' && matched) {
    return { liveness: 'live', livenessBasis: `waiting on you · claude in ${agent.worktree}` };
  }

  if (recencyMs < LIVE_RECENT_MS) {
    if (matched) return { liveness: 'live', livenessBasis: `live claude in ${agent.worktree} · active ${ago} ago` };
    if (anyAlive) return { liveness: 'live', livenessBasis: `claude running · active ${ago} ago` };
    return { liveness: 'idle', livenessBasis: `active ${ago} ago · no live process` };
  }
  if (recencyMs < IDLE_RECENT_MS) return { liveness: 'idle', livenessBasis: `active ${ago} ago` };
  return { liveness: 'ended', livenessBasis: `idle ${ago} · no recent activity` };
}

export function classifyCodexLiveness(
  agent: AgentRecord,
  handles: Set<string>,
  now = Date.now(),
): { liveness: Liveness; livenessBasis: string } {
  const recencyMs = now - agent.updatedAt;
  const ago = humanizeAgo(idleSeconds(agent.updatedAt, now));
  if (handles.has(agent.sourceFile)) return { liveness: 'live', livenessBasis: 'open file handle (focused thread)' };
  if (recencyMs < IDLE_RECENT_MS) return { liveness: 'idle', livenessBasis: `active ${ago} ago · no open handle` };
  return { liveness: 'ended', livenessBasis: `idle ${ago}` };
}

import { promises as fs } from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import Database from 'better-sqlite3';
import {
  CLAUDE_PROJECTS_DIR,
  CODEX_SESSIONS_DIR,
  CODEX_STATE_DB,
  INGEST_WINDOW_MS,
  SUBAGENT_ACTIVE_MS,
  SWEEP_INTERVAL_MS,
  GIT_CACHE_MS,
  MC_DIR,
} from '../shared/config';
import type { AgentRecord, AgentBrief, PullRequest } from '../shared/types';
import { store } from './store';
import { getMeta, getBrief, setMeta } from './meta';
import { considerSynthesis } from './synthesizer';
import { considerPr } from './pr';
import { refreshProjects, scheduleProjectRefresh } from './projects';
import { gitOut } from './git';
import { idleSeconds } from './time';
import { tailLines, parseJsonl, readFirstJson } from './tail';
import { buildClaudeAgent, isClaudeSessionFile } from './adapters/claude';
import { buildCodexAgent, type CodexThread } from './adapters/codex';
import { getClaudeProcesses, getCodexHandles, classifyClaudeLiveness, classifyCodexLiveness } from './liveness';

// Safety cap so the per-cwd/path caches can't grow without bound on long-running machines.
const CACHE_MAX = 2000;

// ───────────────────────── git enrichment (cached per cwd) ─────────────────────────
const gitCache = new Map<string, { t: number; top: string | null; branch: string | null }>();
async function gitInfo(cwd: string): Promise<{ top: string | null; branch: string | null }> {
  if (!cwd) return { top: null, branch: null };
  const cached = gitCache.get(cwd);
  if (cached && Date.now() - cached.t < GIT_CACHE_MS) return cached;
  // Arg-array git (no shell) so a maliciously-named cwd can't inject — same safety as git.ts.
  const top = (await gitOut(['-C', cwd, 'rev-parse', '--show-toplevel'])).trim() || null;
  const branch = (await gitOut(['-C', cwd, 'branch', '--show-current'])).trim() || null;
  const v = { t: Date.now(), top, branch };
  gitCache.set(cwd, v);
  if (gitCache.size > CACHE_MAX) gitCache.delete(gitCache.keys().next().value!);
  return v;
}

// ───────────────────────── enrichment pipeline ─────────────────────────
async function enrich(agent: AgentRecord, now = Date.now()): Promise<AgentRecord> {
  // user metadata
  const meta = getMeta(agent.id);
  agent.pinned = meta.pinned;
  agent.jobName = meta.jobName;
  agent.dismissed = meta.dismissed;
  agent.blocked = meta.blocked;
  agent.notes = meta.notes;
  // Stable display order: assigned once on first sight (newer-first), frozen thereafter so cards
  // never reshuffle on their own. The user can drag to override (persisted).
  if (meta.order == null) {
    agent.order = -agent.updatedAt;
    setMeta(agent.id, { order: agent.order });
  } else {
    agent.order = meta.order;
  }

  // git: worktree root + live branch (robust to the agent cd-ing into a subdir)
  const { top, branch } = await gitInfo(agent.cwd);
  if (top) agent.worktree = path.basename(top);
  if (branch) agent.branch = branch;

  // liveness
  if (agent.tool === 'codex') {
    const handles = await getCodexHandles(now);
    Object.assign(agent, classifyCodexLiveness(agent, handles, now));
  } else {
    const procs = await getClaudeProcesses(now);
    Object.assign(agent, classifyClaudeLiveness(agent, procs, top, now));
    agent.subagentsActive = await countClaudeSubagents(agent, now);
  }

  agent.idleSec = idleSeconds(agent.updatedAt, now);
  return agent;
}

/** Count background subagent sidechains modified very recently for a Claude session. */
async function countClaudeSubagents(agent: AgentRecord, now: number): Promise<number | null> {
  const dir = path.join(path.dirname(agent.sourceFile), agent.id);
  let count = 0;
  try {
    await walk(dir, async (file, st) => {
      if (path.basename(file).startsWith('agent-') && file.endsWith('.jsonl') && now - st.mtimeMs < SUBAGENT_ACTIVE_MS) count++;
    });
  } catch {
    return null;
  }
  return count;
}

/** Carry async enrichments (brief, PR) forward across re-parses so cards don't flicker back to
 *  "synthesizing"/empty when new activity arrives. Restores a persisted brief when its hash matches. */
function carryEnrichment(agent: AgentRecord): void {
  const prev = store.get(agent.id);
  // Always show the last-known brief immediately (even if slightly stale) rather than blanking to
  // "Synthesizing…" — considerSynthesis refreshes it in the background when the content has changed.
  if (prev?.brief) agent.brief = prev.brief;
  else agent.brief = getBrief(agent.id)?.brief ?? null;
  if (prev?.pr) agent.pr = prev.pr;
}

/**
 * Store an enriched agent and trigger its async follow-ups: carry forward prior
 * brief/PR (anti-flicker), upsert, surface a brand-new repo, and kick synthesis + PR fetch.
 */
function commitAgent(agent: AgentRecord): void {
  carryEnrichment(agent);
  const wasNew = !store.get(agent.id);
  store.upsert(agent);
  if (wasNew) scheduleProjectRefresh(); // surface a brand-new repo promptly
  considerSynthesis(agent, applyBrief);
  void considerPr(agent, applyPr);
}

/** Apply a freshly-synthesized brief to the stored record and push it. */
function applyBrief(id: string, brief: AgentBrief): void {
  const a = store.get(id);
  if (a) store.upsert({ ...a, brief });
}

/** Apply a freshly-fetched PR status to the stored record and push it. */
function applyPr(id: string, pr: PullRequest | null): void {
  const a = store.get(id);
  if (a) store.upsert({ ...a, pr });
}

async function walk(dir: string, fn: (file: string, st: import('node:fs').Stats) => Promise<void>): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, fn);
    else await fn(full, await fs.stat(full));
  }
}

// ───────────────────────── Claude ingestion ─────────────────────────
async function ingestClaudeFile(file: string, now = Date.now()): Promise<void> {
  if (!isClaudeSessionFile(file)) return;
  let tail;
  try {
    tail = await tailLines(file);
  } catch {
    return; // file vanished
  }
  if (now - tail.mtimeMs > INGEST_WINDOW_MS) return; // too old to care about
  const records = parseJsonl(tail.lines);
  let agent: AgentRecord;
  if (records.length === 0) {
    // soft-fail: keep a placeholder with the raw last line
    const id = path.basename(file).replace(/\.jsonl$/, '');
    agent = placeholder(id, 'claude', file, tail.mtimeMs, tail.lines.at(-1) ?? null);
  } else {
    agent = buildClaudeAgent(file, records, tail.mtimeMs);
  }
  const enriched = await enrich(agent, now);
  if (enriched.cwd && enriched.cwd.startsWith(MC_DIR)) return; // skip our own synthesis sessions
  commitAgent(enriched);
}

async function scanClaude(now = Date.now()): Promise<void> {
  let projectDirs: string[];
  try {
    projectDirs = (await fs.readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => path.join(CLAUDE_PROJECTS_DIR, e.name));
  } catch {
    return;
  }
  for (const dir of projectDirs) {
    let files: string[];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const f of files) await ingestClaudeFile(path.join(dir, f), now);
  }
}

// ───────────────────────── Codex ingestion ─────────────────────────
function readCodexThreads(now = Date.now()): CodexThread[] {
  let db: Database.Database;
  try {
    db = new Database(CODEX_STATE_DB, { readonly: true, fileMustExist: true });
  } catch {
    return [];
  }
  try {
    const since = now - INGEST_WINDOW_MS;
    const rows = db
      .prepare(
        `SELECT id, cwd, git_branch, title, archived, updated_at_ms, updated_at, model, tokens_used,
                first_user_message, preview, rollout_path, source
         FROM threads WHERE COALESCE(updated_at_ms, updated_at*1000) >= ? ORDER BY updated_at_ms DESC LIMIT 200`,
      )
      .all(since) as CodexThread[];
    return rows;
  } catch {
    return [];
  } finally {
    db.close();
  }
}

async function ingestCodexThread(thread: CodexThread, now = Date.now()): Promise<void> {
  if (thread.archived) return;
  let tail;
  try {
    tail = await tailLines(thread.rollout_path);
  } catch {
    // rollout file missing but DB row exists — still surface a minimal record
    commitAgent(await enrich(buildCodexAgent(thread, [], thread.updated_at_ms ?? now), now));
    return;
  }
  const records = parseJsonl(tail.lines);
  // session_meta (with originator) is at the file head for completed threads.
  const head = await readFirstJson(thread.rollout_path).catch(() => null);
  const originator = head?.payload?.originator ?? null;
  commitAgent(await enrich(buildCodexAgent(thread, records, tail.mtimeMs, originator), now));
}

async function scanCodex(now = Date.now()): Promise<void> {
  for (const thread of readCodexThreads(now)) await ingestCodexThread(thread, now);
}

// rollout path -> thread, so a rollout file change re-ingests the right thread
let codexByRollout = new Map<string, CodexThread>();
function refreshCodexIndex(now = Date.now()): CodexThread[] {
  const threads = readCodexThreads(now);
  codexByRollout = new Map(threads.map((t) => [t.rollout_path, t]));
  return threads;
}

function placeholder(id: string, tool: 'claude' | 'codex', file: string, mtimeMs: number, rawTail: string | null): AgentRecord {
  return {
    id, tool, runtime: 'unknown', cwd: '', worktree: '', branch: null, job: 'Unparsed session',
    status: 'unknown', statusDetail: null, liveness: 'unknown', livenessBasis: 'could not parse transcript',
    lastAction: null, lastMessage: null, lastUserPrompt: null, history: [], tokens: null, contextWindow: null, model: null,
    subagentsActive: null, idleSec: null, startedAt: null, updatedAt: mtimeMs, prLink: null, permissionMode: null,
    brief: null, pr: null, sourceFile: file, rawTail, pinned: false, jobName: null, dismissed: false, blocked: false, notes: null, order: 0,
  };
}

// ───────────────────────── watchers + sweep ─────────────────────────
function watchClaude(): void {
  const watcher = chokidar.watch(CLAUDE_PROJECTS_DIR, {
    ignoreInitial: true,
    depth: 2, // project-dir/*.jsonl is depth 1; we don't need the deep sidechain trees
    ignored: (p: string) => p.includes('/subagents/') || p.includes('/workflows/') || path.basename(p).startsWith('agent-'),
  });
  const onChange = (file: string) => {
    if (file.endsWith('.jsonl')) void ingestClaudeFile(file).catch(() => {});
  };
  watcher.on('add', onChange).on('change', onChange);
}

function watchCodex(): void {
  const watcher = chokidar.watch(CODEX_SESSIONS_DIR, { ignoreInitial: true, depth: 4 });
  const onChange = (file: string) => {
    if (!file.endsWith('.jsonl')) return;
    let thread = codexByRollout.get(file);
    if (!thread) {
      refreshCodexIndex();
      thread = codexByRollout.get(file);
    }
    if (thread) void ingestCodexThread(thread).catch(() => {});
  };
  watcher.on('add', onChange).on('change', onChange);
}

/** Backstop: liveness/idle change produces no fs event, so re-evaluate everything periodically. */
let sweeping = false;
async function sweep(): Promise<void> {
  // Never let a slow sweep overlap the next one — that's how git/gh subprocesses pile up and
  // flood the machine. If the previous sweep is still running, skip this tick.
  if (sweeping) return;
  sweeping = true;
  try {
    await sweepOnce();
  } finally {
    sweeping = false;
  }
}

async function sweepOnce(): Promise<void> {
  const now = Date.now();
  refreshCodexIndex(now);
  for (const agent of store.all()) {
    if (agent.liveness === 'live') {
      // Live agents: re-READ the transcript every sweep so the card stays current even if a
      // filesystem event was missed, and so synthesis re-triggers as the agent works.
      if (agent.tool === 'claude') {
        await ingestClaudeFile(agent.sourceFile, now);
        continue;
      }
      const thread = codexByRollout.get(agent.sourceFile);
      if (thread) {
        await ingestCodexThread(thread, now);
        continue;
      }
    }
    // Everyone else: cheap re-enrich (refreshes liveness/idle; probes are cached).
    const e = await enrich({ ...agent }, now);
    store.upsert(e);
    considerSynthesis(e, applyBrief);
    void considerPr(e, applyPr);
  }
  // Rebuild the project/worktree topology from fresh agent state (git/PR probes are cached).
  await refreshProjects(now);
}

export async function startCollector(): Promise<void> {
  refreshCodexIndex();
  await Promise.all([scanClaude(), scanCodex()]);
  await refreshProjects(); // initial project/worktree topology
  watchClaude();
  watchCodex();
  setInterval(() => void sweep().catch(() => {}), SWEEP_INTERVAL_MS);
}

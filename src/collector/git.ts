import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { WORKTREE_GIT_TTL_MS, WORKTREE_LIST_TTL_MS } from '../shared/config';

const execFileAsync = promisify(execFile);

// Safety cap so the per-path caches can't grow without bound on long-running machines.
const CACHE_MAX = 2000;

// Hard cap on concurrent `git` subprocesses. Many callers (per-agent, per-slot, per-sweep)
// can fire at once; without this, a slow sweep that overlaps the next floods the machine
// with hundreds of git processes and the whole collector chokes. Excess calls queue.
const GIT_CONCURRENCY = 8;
let gitActive = 0;
const gitWaiters: Array<() => void> = [];
function acquireGit(): Promise<void> {
  if (gitActive < GIT_CONCURRENCY) {
    gitActive++;
    return Promise.resolve();
  }
  return new Promise((resolve) => gitWaiters.push(resolve));
}
function releaseGit(): void {
  const next = gitWaiters.shift();
  if (next) next(); // hand the slot straight to the next waiter (gitActive stays put)
  else gitActive--;
}

/**
 * Run git with an ARGUMENT ARRAY (never a shell string) so paths — including
 * user-supplied ones — can't inject. Swallows non-zero exits (git exits non-zero
 * on "no upstream", "not a repo", etc.) and returns whatever stdout it produced.
 * Concurrency-gated so callers can't flood the machine with git subprocesses.
 */
export async function gitOut(args: string[]): Promise<string> {
  await acquireGit();
  try {
    const { stdout } = await execFileAsync('git', args, { timeout: 6000, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch (e: any) {
    return typeof e?.stdout === 'string' ? e.stdout : '';
  } finally {
    releaseGit();
  }
}

export interface RawWorktree {
  path: string;
  head: string | null;
  branch: string | null; // stripped of refs/heads/
  detached: boolean;
  bare: boolean;
}

/**
 * Parse `git worktree list --porcelain`. Blocks are separated by blank lines;
 * each begins with `worktree <abs path>`. The FIRST block is the primary checkout.
 */
export function parseWorktreeList(porcelain: string): RawWorktree[] {
  const out: RawWorktree[] = [];
  let cur: RawWorktree | null = null;
  const flush = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush();
      cur = { path: line.slice('worktree '.length).trim(), head: null, branch: null, detached: false, bare: false };
    } else if (!cur) {
      continue;
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length).trim() || null;
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '') || null;
    } else if (line.trim() === 'detached') {
      cur.detached = true;
    } else if (line.trim() === 'bare') {
      cur.bare = true;
    }
  }
  flush();
  return out;
}

// ── worktree enumeration (cached; a sweep would otherwise re-run this per project every 2s) ──
const worktreeListCache = new Map<string, { t: number; v: RawWorktree[] }>();
/** Enumerate every worktree of the repo containing `anyPathInRepo` (primary first). */
export async function listWorktrees(anyPathInRepo: string): Promise<RawWorktree[]> {
  const cached = worktreeListCache.get(anyPathInRepo);
  if (cached && Date.now() - cached.t < WORKTREE_LIST_TTL_MS) return cached.v;
  const parsed = parseWorktreeList(await gitOut(['-C', anyPathInRepo, 'worktree', 'list', '--porcelain']));
  // An empty result is almost always a transient git failure (the repo always has ≥1 worktree),
  // so keep the last-known-good list rather than dropping the project this sweep.
  if (parsed.length === 0 && cached) return cached.v;
  worktreeListCache.set(anyPathInRepo, { t: Date.now(), v: parsed });
  if (worktreeListCache.size > CACHE_MAX) worktreeListCache.delete(worktreeListCache.keys().next().value!);
  return parsed;
}

// ── grouping key: realpath of the git-common-dir (stable across worktree churn) ──
const commonDirCache = new Map<string, { t: number; v: string }>();
export async function commonDir(p: string): Promise<string | null> {
  if (!p) return null;
  const cached = commonDirCache.get(p);
  if (cached && Date.now() - cached.t < WORKTREE_LIST_TTL_MS) return cached.v;
  const raw = (await gitOut(['-C', p, 'rev-parse', '--git-common-dir'])).trim();
  // Transient git failure → don't poison the cache with null; reuse the last-known grouping
  // (otherwise one hiccup drops the project for the whole TTL and tabs flicker away).
  if (!raw) return cached?.v ?? null;
  const abs = path.isAbsolute(raw) ? raw : path.resolve(p, raw);
  let v: string;
  try {
    v = await realpath(abs);
  } catch {
    v = abs;
  }
  commonDirCache.set(p, { t: Date.now(), v });
  if (commonDirCache.size > CACHE_MAX) commonDirCache.delete(commonDirCache.keys().next().value!);
  return v;
}

/** The repo's primary toplevel (realpath'd). Used to validate a manually-added path. */
export async function showToplevel(p: string): Promise<string | null> {
  const raw = (await gitOut(['-C', p, 'rev-parse', '--show-toplevel'])).trim();
  if (!raw) return null;
  try {
    return await realpath(raw);
  } catch {
    return raw;
  }
}

export interface SlotGit {
  dirty: boolean | null; // null when the worktree dir is gone
  ahead: number | null; // commits ahead of upstream (null when no upstream)
  behind: number | null;
  exists: boolean;
}

// ── per-slot working-tree state (cached; live slots pass ttl=0 to bypass) ──
const slotGitCache = new Map<string, { t: number; v: SlotGit }>();
export async function slotGit(p: string, ttl = WORKTREE_GIT_TTL_MS): Promise<SlotGit> {
  const cached = slotGitCache.get(p);
  if (cached && Date.now() - cached.t < ttl) return cached.v;

  let exists = true;
  try {
    await stat(p);
  } catch {
    exists = false;
  }

  let v: SlotGit;
  if (!exists) {
    v = { dirty: null, ahead: null, behind: null, exists: false };
  } else {
    const status = await gitOut(['-C', p, 'status', '--porcelain']);
    const dirty = status.trim().length > 0;
    const rl = (await gitOut(['-C', p, 'rev-list', '--count', '--left-right', '@{u}...HEAD'])).trim();
    let ahead: number | null = null;
    let behind: number | null = null;
    const m = rl.match(/^(\d+)\s+(\d+)$/); // left=behind (upstream-only), right=ahead (HEAD-only)
    if (m) {
      behind = Number(m[1]);
      ahead = Number(m[2]);
    }
    v = { dirty, ahead, behind, exists: true };
  }
  slotGitCache.set(p, { t: Date.now(), v });
  if (slotGitCache.size > CACHE_MAX) slotGitCache.delete(slotGitCache.keys().next().value!);
  return v;
}

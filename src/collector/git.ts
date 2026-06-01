import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { WORKTREE_GIT_TTL_MS, WORKTREE_LIST_TTL_MS } from '../shared/config';

const execFileAsync = promisify(execFile);

/**
 * Run git with an ARGUMENT ARRAY (never a shell string) so paths — including
 * user-supplied ones — can't inject. Swallows non-zero exits (git exits non-zero
 * on "no upstream", "not a repo", etc.) and returns whatever stdout it produced.
 */
async function gitOut(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { timeout: 6000, maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch (e: any) {
    return typeof e?.stdout === 'string' ? e.stdout : '';
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

/** Enumerate every worktree of the repo containing `anyPathInRepo` (primary first). */
export async function listWorktrees(anyPathInRepo: string): Promise<RawWorktree[]> {
  return parseWorktreeList(await gitOut(['-C', anyPathInRepo, 'worktree', 'list', '--porcelain']));
}

// ── grouping key: realpath of the git-common-dir (stable across worktree churn) ──
const commonDirCache = new Map<string, { t: number; v: string | null }>();
export async function commonDir(p: string): Promise<string | null> {
  if (!p) return null;
  const cached = commonDirCache.get(p);
  if (cached && Date.now() - cached.t < WORKTREE_LIST_TTL_MS) return cached.v;
  const raw = (await gitOut(['-C', p, 'rev-parse', '--git-common-dir'])).trim();
  let v: string | null = null;
  if (raw) {
    const abs = path.isAbsolute(raw) ? raw : path.resolve(p, raw);
    try {
      v = await realpath(abs);
    } catch {
      v = abs;
    }
  }
  commonDirCache.set(p, { t: Date.now(), v });
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
  return v;
}

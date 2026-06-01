import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MC_DIR, PR_ENABLED, PR_TTL_MS, PR_TTL_LIVE_MS, PR_TTL_HOT_MS, PR_CONCURRENCY, SYNTH_FRESH_MS } from '../shared/config';
import type { AgentRecord, AgentBrief, CiStatus, Liveness, PullRequest } from '../shared/types';
import { commonDir } from './git';

const execFileAsync = promisify(execFile);

const FIELDS = 'number,url,title,state,isDraft,mergeable,mergeStateStatus,baseRefName,statusCheckRollup';
const BASE_BRANCHES = new Set(['master', 'main', 'develop', 'HEAD', '']);

const FAIL_CONCLUSIONS = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE']);
const PENDING_STATES = new Set(['QUEUED', 'IN_PROGRESS', 'PENDING', 'WAITING', 'EXPECTED', 'REQUESTED']);

function rollupToCi(roll: any[]): { ci: CiStatus; failing: number } {
  let failing = 0;
  let pending = 0;
  for (const c of roll) {
    const concl = String(c.conclusion ?? '').toUpperCase();
    const state = String(c.status ?? c.state ?? '').toUpperCase();
    if (FAIL_CONCLUSIONS.has(concl) || state === 'FAILURE' || state === 'ERROR') failing++;
    else if (PENDING_STATES.has(state) || (!concl && state && state !== 'COMPLETED')) pending++;
  }
  let ci: CiStatus;
  if (roll.length === 0) ci = 'none';
  else if (failing > 0) ci = 'failing';
  else if (pending > 0) ci = 'pending';
  else ci = 'passing';
  return { ci, failing };
}

function toPr(d: any): PullRequest {
  const roll: any[] = Array.isArray(d.statusCheckRollup) ? d.statusCheckRollup : [];
  const { ci, failing } = rollupToCi(roll);
  const mss = String(d.mergeStateStatus ?? '').toUpperCase();
  return {
    number: d.number,
    url: d.url,
    title: d.title ?? '',
    state: d.state ?? 'OPEN',
    isDraft: !!d.isDraft,
    baseRef: d.baseRefName ?? '',
    conflicts: d.mergeable === 'CONFLICTING' || mss === 'DIRTY',
    behindBase: mss === 'BEHIND',
    mergeStateStatus: mss,
    ci,
    checksTotal: roll.length,
    checksFailing: failing,
    at: Date.now(),
  };
}

export async function fetchPr(cwd: string, branch: string): Promise<PullRequest | null> {
  try {
    const { stdout } = await execFileAsync('gh', ['pr', 'view', branch, '--json', FIELDS], {
      cwd,
      timeout: 12_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const d = JSON.parse(stdout);
    if (d?.number == null) return null;
    return toPr(d);
  } catch {
    return null; // no PR for the branch, not a repo, gh not authed, etc.
  }
}

function samePr(a: PullRequest | null, b: PullRequest | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.number === b.number &&
    a.state === b.state &&
    a.ci === b.ci &&
    a.conflicts === b.conflicts &&
    a.behindBase === b.behindBase &&
    a.isDraft === b.isDraft
  );
}

// ── scheduler: cache by repo+branch, concurrency gate ──
const cache = new Map<string, { at: number; pr: PullRequest | null }>();
const inflight = new Set<string>();
let active = 0;
const pending: Array<() => void> = [];

function pump(): void {
  while (active < PR_CONCURRENCY && pending.length) {
    const job = pending.shift()!;
    active++;
    job();
  }
}

function schedule(job: () => Promise<void>): void {
  pending.push(() => void job().finally(() => { active--; pump(); }));
  pump();
}

export type ApplyPr = (id: string, pr: PullRequest | null) => void;

/**
 * A PR fetch target — the structural subset of an agent we need. A worktree
 * SLOT (which may have no agent) can drive PR polling through the same path.
 */
export interface PrTarget {
  id: string; // the key passed back to `apply` (an agent id, or a synthetic slot key)
  cwd: string; // a path inside the worktree to run `gh` from
  branch: string | null;
  worktree: string; // basename label (fallback cache discriminator)
  repo?: string; // repo-unique discriminator (git common-dir) — keys the cache, so two repos
  // with the same worktree basename + branch don't collide. Falls back to `worktree`.
  liveness: Liveness;
  updatedAt: number;
  pr?: PullRequest | null; // current value, to avoid a redundant apply
  lastAction?: string | null;
  statusDetail?: string | null;
  brief?: AgentBrief | null;
}

/** The shared cache key — repo-discriminated so identically-named worktrees across repos don't collide. */
function prCacheKey(repo: string, branch: string): string {
  return `${repo}|${branch}`;
}

/** How fresh the PR status must be, by how actively the target is touching it. */
function pollTtl(t: PrTarget): number {
  if (t.liveness !== 'live') return PR_TTL_MS;
  // A live agent in release phase, or whose latest action mentions the PR/merge/CI, is changing
  // PR state right now — poll it near-realtime.
  const signal = `${t.lastAction ?? ''} ${t.statusDetail ?? ''} ${t.brief?.nextStep ?? ''}`.toLowerCase();
  const hot = t.brief?.phase === 'release' || t.brief?.phase === 'code-review' || /\b(pr|merg|push|gh pr|ci|checks?|deploy)\b/.test(signal);
  return hot ? PR_TTL_HOT_MS : PR_TTL_LIVE_MS;
}

export function considerPrFor(t: PrTarget, apply: ApplyPr): void {
  if (!PR_ENABLED) return;
  if (t.cwd && t.cwd.startsWith(MC_DIR)) return;
  const branch = t.branch ?? '';
  if (BASE_BRANCHES.has(branch)) return; // base branches don't have their own PR
  const fresh = t.liveness === 'live' || Date.now() - t.updatedAt < SYNTH_FRESH_MS;
  if (!fresh) return;

  const key = prCacheKey(t.repo ?? t.worktree, branch);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < pollTtl(t)) {
    if (!samePr(t.pr ?? null, cached.pr)) apply(t.id, cached.pr);
    return;
  }
  if (inflight.has(key)) return;
  inflight.add(key);

  schedule(async () => {
    try {
      const pr = await fetchPr(t.cwd, branch);
      cache.set(key, { at: Date.now(), pr });
      if (cache.size > 2000) cache.delete(cache.keys().next().value!);
      apply(t.id, pr);
    } finally {
      inflight.delete(key);
    }
  });
}

/** An AgentRecord is a structural superset of PrTarget; add its repo (common-dir) for the key. */
export async function considerPr(agent: AgentRecord, apply: ApplyPr): Promise<void> {
  const repo = (await commonDir(agent.cwd)) ?? agent.worktree;
  considerPrFor({ ...agent, repo }, apply);
}

/** Read the last-fetched PR for a repo+branch from the shared cache (no fetch). */
export function getCachedPr(repo: string, branch: string | null): PullRequest | null {
  if (!branch || BASE_BRANCHES.has(branch)) return null;
  return cache.get(prCacheKey(repo, branch))?.pr ?? null;
}

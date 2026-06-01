import { EventEmitter } from 'node:events';
import path from 'node:path';
import { MC_DIR } from '../shared/config';
import { STATUS_SORT } from '../shared/types';
import type { AgentRecord, Project, WorktreeSlot, SlotAgentRef, PullRequest } from '../shared/types';
import { store } from './store';
import { within } from './liveness';
import { commonDir, listWorktrees, slotGit, type RawWorktree } from './git';
import { getProjectMeta } from './meta';
import { considerPrFor, getCachedPr } from './pr';

// ───────────────────────── pure join helpers (unit-tested) ─────────────────────────

/** Whether a target needs the human (server-side mirror of the web `needsYou`). */
function agentNeedsYou(a: AgentRecord): boolean {
  if (a.brief?.needsYou) return true;
  return a.status === 'waiting' || a.status === 'error';
}

/**
 * Choose the agent that "occupies" a worktree slot among all that map to it.
 * Rule: a LIVE agent wins outright; otherwise the most-recently-updated; ties
 * break by status priority (waiting > error > …) then id for determinism.
 */
export function pickWinner(candidates: AgentRecord[]): AgentRecord | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((x, y) => {
    const lx = x.liveness === 'live' ? 0 : 1;
    const ly = y.liveness === 'live' ? 0 : 1;
    if (lx !== ly) return lx - ly; // live first
    if (x.updatedAt !== y.updatedAt) return y.updatedAt - x.updatedAt; // most recent
    const sx = STATUS_SORT[x.status];
    const sy = STATUS_SORT[y.status];
    if (sx !== sy) return sx - sy; // status priority
    return x.id < y.id ? -1 : 1;
  })[0]!;
}

export function toSlotAgentRef(a: AgentRecord): SlotAgentRef {
  return {
    id: a.id,
    tool: a.tool,
    status: a.status,
    liveness: a.liveness,
    job: a.jobName?.trim() || a.job,
    needsYou: agentNeedsYou(a),
  };
}

// ───────────────────────── project store (separate from agents) ─────────────────────────

export type ProjectStoreChange = { type: 'upsert'; project: Project } | { type: 'remove'; id: string };

function refEqual(x: SlotAgentRef | null, y: SlotAgentRef | null): boolean {
  if (!x || !y) return x === y;
  return x.id === y.id && x.status === y.status && x.liveness === y.liveness && x.needsYou === y.needsYou && x.tool === y.tool;
}

function prEqual(x: PullRequest | null, y: PullRequest | null): boolean {
  if (!x || !y) return x === y;
  return x.number === y.number && x.state === y.state && x.ci === y.ci && x.conflicts === y.conflicts && x.behindBase === y.behindBase && x.isDraft === y.isDraft;
}

function slotEqual(x: WorktreeSlot, y: WorktreeSlot): boolean {
  return (
    x.path === y.path &&
    x.branch === y.branch &&
    x.isPrimary === y.isPrimary &&
    x.exists === y.exists &&
    x.detached === y.detached &&
    x.bare === y.bare &&
    x.dirty === y.dirty &&
    x.ahead === y.ahead &&
    x.behind === y.behind &&
    x.sessionsCount === y.sessionsCount &&
    refEqual(x.agent, y.agent) &&
    prEqual(x.pr, y.pr)
  );
}

function projectEqualForUi(a: Project, b: Project): boolean {
  if (a.name !== b.name || a.root !== b.root || a.origin !== b.origin) return false;
  if (a.slots.length !== b.slots.length) return false;
  for (let i = 0; i < a.slots.length; i++) if (!slotEqual(a.slots[i]!, b.slots[i]!)) return false;
  return true;
}

class ProjectStore extends EventEmitter {
  private map = new Map<string, Project>();

  upsert(p: Project): void {
    const prev = this.map.get(p.id);
    this.map.set(p.id, p);
    if (!prev || !projectEqualForUi(prev, p)) {
      this.emit('change', { type: 'upsert', project: p } satisfies ProjectStoreChange);
    }
  }

  remove(id: string): void {
    if (this.map.delete(id)) this.emit('change', { type: 'remove', id } satisfies ProjectStoreChange);
  }

  get(id: string): Project | undefined {
    return this.map.get(id);
  }

  all(): Project[] {
    return [...this.map.values()];
  }
}

export const projectStore = new ProjectStore();

// ───────────────────────── topology builder ─────────────────────────

// The currently-viewed project (a client hint) — empty-slot PRs only poll for it
// (or for projects with a live agent), to keep `gh` volume bounded.
let activeProjectId: string | null = null;
export function setActiveProject(id: string | null): void {
  activeProjectId = id;
}

/** Assign each agent to its MOST-SPECIFIC (deepest) containing worktree. */
function bucketAgents(agents: AgentRecord[], raws: RawWorktree[]): Map<string, AgentRecord[]> {
  const out = new Map<string, AgentRecord[]>();
  for (const a of agents) {
    let best: RawWorktree | null = null;
    for (const raw of raws) {
      if (within(a.cwd, raw.path) && (!best || raw.path.length > best.path.length)) best = raw;
    }
    if (best) {
      const list = out.get(best.path) ?? [];
      list.push(a);
      out.set(best.path, list);
    }
  }
  return out;
}

export async function buildProjects(now = Date.now()): Promise<Project[]> {
  const agents = store.all().filter((a) => a.cwd && !a.cwd.startsWith(MC_DIR));

  // Group agents by their repo's common-dir; remember one path per repo to enumerate worktrees.
  const agentsByProject = new Map<string, AgentRecord[]>();
  const anyPath = new Map<string, string>();
  for (const a of agents) {
    const cd = await commonDir(a.cwd);
    if (!cd) continue;
    const list = agentsByProject.get(cd) ?? [];
    list.push(a);
    agentsByProject.set(cd, list);
    if (!anyPath.has(cd)) anyPath.set(cd, a.cwd);
  }

  // Manual + hidden projects.
  const meta = getProjectMeta();
  const hidden = new Set<string>();
  const manual = new Set<string>();
  for (const m of meta) {
    const cd = (await commonDir(m.path)) ?? m.id;
    if (m.hidden) {
      hidden.add(cd);
      continue;
    }
    manual.add(cd);
    if (!anyPath.has(cd)) anyPath.set(cd, m.path);
    if (!agentsByProject.has(cd)) agentsByProject.set(cd, []);
  }

  const projects: Project[] = [];
  for (const [id, repoPath] of anyPath) {
    if (hidden.has(id)) continue;
    const raws = await listWorktrees(repoPath);
    if (raws.length === 0) continue;
    const root = raws[0]!.path; // primary checkout
    const projAgents = agentsByProject.get(id) ?? [];
    const buckets = bucketAgents(projAgents, raws);
    const hasLiveAgent = projAgents.some((a) => a.liveness === 'live');

    const slots: WorktreeSlot[] = [];
    for (let i = 0; i < raws.length; i++) {
      const raw = raws[i]!;
      const candidates = buckets.get(raw.path) ?? [];
      const winner = pickWinner(candidates);
      const live = winner?.liveness === 'live';
      const wtName = path.basename(raw.path);

      const git = raw.bare
        ? { dirty: null, ahead: null, behind: null, exists: true }
        : await slotGit(raw.path, live ? 0 : undefined);

      // Occupied slots read the winner's PR; empty/occupied both fall back to the shared cache
      // (keyed by the project id = git common-dir, so identically-named worktrees don't collide).
      const pr = winner?.pr ?? getCachedPr(id, raw.branch);

      // Keep an empty, non-base slot's PR warm — but only for the active project or one with a
      // live agent, so dormant worktrees don't trigger `gh` storms.
      if (!winner && raw.branch && (id === activeProjectId || hasLiveAgent)) {
        considerPrFor(
          { id: `${id}|${raw.path}`, cwd: raw.path, branch: raw.branch, worktree: wtName, repo: id, liveness: 'ended', updatedAt: now, pr },
          () => {}, // result lands in the shared cache; picked up on the next rebuild
        );
      }

      slots.push({
        path: raw.path,
        branch: raw.branch,
        isPrimary: i === 0,
        exists: git.exists,
        detached: raw.detached,
        bare: raw.bare,
        dirty: git.dirty,
        ahead: git.ahead,
        behind: git.behind,
        pr,
        agent: winner ? toSlotAgentRef(winner) : null,
        sessionsCount: candidates.length,
      });
    }

    projects.push({ id, name: path.basename(root), root, slots, origin: manual.has(id) ? 'manual' : 'discovered', at: now });
  }
  return projects;
}

/** Rebuild the topology and reconcile the project store (add/update/remove). */
export async function refreshProjects(now = Date.now()): Promise<void> {
  const projects = await buildProjects(now);
  const seen = new Set(projects.map((p) => p.id));
  for (const p of projects) projectStore.upsert(p);
  for (const existing of projectStore.all()) if (!seen.has(existing.id)) projectStore.remove(existing.id);
}

// Debounced refresh, e.g. when a brand-new repo's first agent appears mid-sweep.
let pending = false;
export function scheduleProjectRefresh(): void {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    void refreshProjects().catch(() => {});
  }, 750);
}

/// <reference types="vite/client" />
import { useEffect, useState } from 'react';
import type { AgentRecord, Project, ServerEvent, SlotAgentRef, Tool, WorktreeSlot } from '../shared/types';

/**
 * Dev-only mock toggle. The DEFAULT is to hit the real `/api` endpoints.
 * Flip to `true` (or set `localStorage.mcMock = '1'`) to render seeded data
 * without a running backend. Never enabled in a production build.
 */
const MOCK_FLAG = false;

function mockEnabled(): boolean {
  if (MOCK_FLAG) return true;
  try {
    return (
      import.meta.env.DEV &&
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('mcMock') === '1'
    );
  } catch {
    return false;
  }
}

export type ConnectionState = 'connecting' | 'open' | 'reconnecting';

export interface AgentStream {
  /** Current set of agents (already merged from snapshot + upserts/removes). */
  agents: AgentRecord[];
  /** Current project/worktree topology (merged from snapshot + project events). */
  projects: Project[];
  /** True until the first snapshot (or mock seed) has arrived. */
  loading: boolean;
  /** SSE connection health for the TopBar indicator. */
  connection: ConnectionState;
  /** Server clock from the most recent event; falls back to Date.now(). */
  serverTime: number;
}

/** Replace the item with the same id (in place — no reorder), or append it. */
function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const next = list.slice();
  next[idx] = item;
  return next;
}

/**
 * Subscribe to the live agent stream.
 *
 * Strategy:
 *  1. GET /api/snapshot for the initial set (fast first paint).
 *  2. Open an EventSource on /api/events for the live stream.
 *     - `snapshot` replaces all, `upsert` adds/updates by id, `remove` deletes.
 *  3. On error, EventSource auto-reconnects; we surface `reconnecting`.
 */
export function useAgentStream(): AgentStream {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [serverTime, setServerTime] = useState<number>(() => Date.now());

  useEffect(() => {
    if (mockEnabled()) {
      const { seed, projects: mp, serverTime: t } = makeMockData();
      setAgents(seed);
      setProjects(mp);
      setServerTime(t);
      setConnection('open');
      setLoading(false);
      const interval = startMockTicker(setAgents, setServerTime);
      return () => clearInterval(interval);
    }

    let cancelled = false;
    let es: EventSource | null = null;

    // 1) Initial snapshot.
    void fetch('/api/snapshot', { headers: { accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error(`snapshot ${r.status}`);
        return r.json() as Promise<{
          agents: AgentRecord[];
          projects: Project[];
          serverTime: number;
        }>;
      })
      .then((data) => {
        if (cancelled) return;
        setAgents(Array.isArray(data.agents) ? data.agents : []);
        setProjects(Array.isArray(data.projects) ? data.projects : []);
        if (typeof data.serverTime === 'number') setServerTime(data.serverTime);
        setLoading(false);
      })
      .catch(() => {
        // Don't fail hard — the SSE snapshot event will populate us anyway.
        if (!cancelled) setLoading(false);
      });

    // 2) Live stream.
    const connect = () => {
      es = new EventSource('/api/events');

      es.onopen = () => {
        if (!cancelled) setConnection('open');
      };

      es.onmessage = (ev: MessageEvent<string>) => {
        if (cancelled) return;
        let parsed: ServerEvent;
        try {
          parsed = JSON.parse(ev.data) as ServerEvent;
        } catch {
          return;
        }
        if (typeof parsed.serverTime === 'number') {
          setServerTime(parsed.serverTime);
        }
        switch (parsed.type) {
          case 'snapshot':
            setAgents(Array.isArray(parsed.agents) ? parsed.agents : []);
            setProjects(Array.isArray(parsed.projects) ? parsed.projects : []);
            setLoading(false);
            break;
          case 'upsert':
            // Update in place — NO flash. Content changes without strobing.
            setAgents((prev) => upsertById(prev, parsed.agent));
            setLoading(false);
            break;
          case 'remove':
            setAgents((prev) => prev.filter((a) => a.id !== parsed.id));
            break;
          case 'project-upsert':
            setProjects((prev) => upsertById(prev, parsed.project));
            break;
          case 'project-remove':
            setProjects((prev) => prev.filter((p) => p.id !== parsed.id));
            break;
        }
      };

      es.onerror = () => {
        if (cancelled) return;
        // EventSource reconnects on its own; reflect the gap in the indicator.
        setConnection('reconnecting');
      };
    };

    connect();

    return () => {
      cancelled = true;
      es?.close();
    };
  }, []);

  return { agents, projects, loading, connection, serverTime };
}

/** POST JSON (or nothing) to an /api endpoint. Shared by the action helpers below. */
function postJson(url: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method: 'POST' };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return fetch(url, init);
}

/**
 * Update user metadata (pin / rename / dismiss / notes) via the meta endpoint.
 * Returns the updated record so callers can merge it optimistically.
 */
export async function updateMeta(
  id: string,
  body: {
    pinned?: boolean;
    jobName?: string | null;
    dismissed?: boolean;
    notes?: string | null;
    order?: number;
  },
): Promise<AgentRecord> {
  const res = await postJson(`/api/agents/${encodeURIComponent(id)}/meta`, body);
  if (!res.ok) throw new Error(`meta ${res.status}`);
  return (await res.json()) as AgentRecord;
}

/** Bring the agent's own window to the front (iTerm tab for Claude, thread for Codex). */
export async function focusAgent(id: string): Promise<{ ok: boolean; detail: string }> {
  const res = await postJson(`/api/agents/${encodeURIComponent(id)}/focus`);
  if (!res.ok) throw new Error(`focus ${res.status}`);
  return (await res.json()) as { ok: boolean; detail: string };
}

/** Start a new agent in an empty worktree slot (Claude = real launch; Codex = open app + copy path). */
export async function launchAgent(worktreePath: string, tool: Tool): Promise<{ ok: boolean; detail: string }> {
  const res = await postJson('/api/launch', { worktreePath, tool });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    return { ok: false, detail: body?.detail ?? `launch ${res.status}` };
  }
  return (await res.json()) as { ok: boolean; detail: string };
}

/** Add a project tab by repo path. The new project arrives via the SSE `project-upsert`. */
export async function addProject(path: string): Promise<{ ok: boolean; detail: string }> {
  const res = await postJson('/api/projects', { path });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, detail: body?.error ?? `add project ${res.status}` };
  }
  return { ok: true, detail: 'Project added' };
}

/** Tell the server which project tab is in view (bounds empty-slot PR polling). Fire-and-forget. */
export function setActiveProject(id: string | null): void {
  void postJson('/api/active-project', { id }).catch(() => {});
}

/* ── Dev mock data (only used when mockEnabled()) ─────────────────────────── */

function makeMockData(): { seed: AgentRecord[]; projects: Project[]; serverTime: number } {
  const now = Date.now();
  const base = (over: Partial<AgentRecord>): AgentRecord => ({
    id: Math.random().toString(36).slice(2),
    tool: 'claude',
    runtime: 'terminal',
    cwd: '/Users/dev/proj',
    worktree: 'proj',
    branch: 'main',
    job: 'Untitled',
    status: 'idle',
    statusDetail: null,
    liveness: 'unknown',
    livenessBasis: 'mock',
    lastAction: null,
    lastMessage: null,
    lastUserPrompt: null,
    history: [],
    tokens: null,
    contextWindow: null,
    model: null,
    subagentsActive: null,
    idleSec: null,
    startedAt: now - 600_000,
    updatedAt: now,
    prLink: null,
    permissionMode: null,
    brief: null,
    pr: null,
    sourceFile: '/mock/session.jsonl',
    rawTail: null,
    pinned: false,
    jobName: null,
    dismissed: false,
    notes: null,
    order: 0,
    ...over,
  });

  const seed: AgentRecord[] = [
    base({
      id: 'a-wait',
      tool: 'claude',
      runtime: 'terminal',
      worktree: 'mission-control',
      branch: 'feat/ui',
      job: 'Build the Mission Control dashboard front-end',
      status: 'waiting',
      statusDetail: 'Approve edit to src/web/App.tsx?',
      liveness: 'live',
      livenessBasis: 'open file handle (lsof)',
      lastAction: 'Edit src/web/App.tsx',
      lastUserPrompt: 'Make the cards draggable but keep their positions stable so nothing reshuffles.',
      lastMessage:
        "I'd like to refactor the grid into a virtualized list. Shall I proceed?",
      tokens: 84_200,
      contextWindow: 200_000,
      model: 'claude-opus-4',
      subagentsActive: 2,
      idleSec: 4,
      updatedAt: now - 4_000,
      permissionMode: 'default',
      pinned: true,
      order: -6000,
      brief: {
        title: 'Dashboard rebuild',
        summary:
          'Rebuilding the Mission Control dashboard front-end as a card layout.',
        phase: 'execution',
        needsYou: true,
        needsReason: 'Wants approval to refactor the grid into a virtualized list.',
        lastAsk: 'Build the Mission Control dashboard front-end.',
        nextStep: 'Approve (or decline) the virtualized-list refactor to continue.',
        at: now - 4_000,
        state: 'ready',
      },
      history: [
        { ts: now - 60_000, kind: 'user', label: 'Build the dashboard' },
        { ts: now - 40_000, kind: 'tool', label: 'Read App.tsx' },
        { ts: now - 20_000, kind: 'subagent', label: 'Spawned reviewer' },
        { ts: now - 4_000, kind: 'message', label: 'Asking for approval' },
      ],
    }),
    base({
      id: 'b-err',
      tool: 'codex',
      runtime: 'app',
      worktree: 'api-gateway',
      branch: 'fix/timeout',
      job: 'Fix the 504 on the billing endpoint',
      status: 'error',
      statusDetail: 'TypeError: cannot read properties of undefined',
      liveness: 'live',
      livenessBasis: 'mtime 9s + codex@cwd',
      lastAction: 'Run pnpm test',
      lastMessage: 'The test suite is failing on the retry logic.',
      tokens: 152_000,
      contextWindow: 256_000,
      model: 'gpt-5-codex',
      idleSec: 9,
      updatedAt: now - 9_000,
      order: -5000,
      prLink: 'https://github.com/acme/api-gateway/pull/412',
      pr: {
        number: 412,
        url: 'https://github.com/acme/api-gateway/pull/412',
        title: 'Fix 504 on billing endpoint',
        state: 'OPEN',
        isDraft: false,
        baseRef: 'master',
        conflicts: false,
        behindBase: true,
        mergeStateStatus: 'BEHIND',
        ci: 'failing',
        checksTotal: 9,
        checksFailing: 1,
        at: now - 9_000,
      },
      brief: {
        title: 'Billing 504 fix',
        summary: 'Fixing intermittent 504s on the billing endpoint.',
        phase: 'testing',
        needsYou: true,
        needsReason: 'The retry-logic test is failing with a TypeError.',
        lastAsk: 'Fix the 504 on the billing endpoint.',
        nextStep: 'Inspect the failing retry test and decide how to handle undefined responses.',
        at: now - 9_000,
        state: 'ready',
      },
    }),
    base({
      id: 'c-busy',
      tool: 'claude',
      runtime: 'ide',
      worktree: 'design-system',
      branch: 'chore/tokens',
      job: 'Migrate color tokens to Tailwind v4 @theme',
      status: 'busy',
      statusDetail: 'Running build…',
      liveness: 'live',
      livenessBasis: 'open file handle (lsof)',
      lastAction: 'Bash npx vite build',
      tokens: 38_000,
      contextWindow: 200_000,
      model: 'claude-sonnet-4',
      idleSec: 1,
      updatedAt: now - 1_000,
      order: -4000,
      pr: {
        number: 145,
        url: 'https://github.com/acme/design-system/pull/145',
        title: 'Migrate colour tokens to Tailwind v4 @theme',
        state: 'OPEN',
        isDraft: false,
        baseRef: 'main',
        conflicts: false,
        behindBase: false,
        mergeStateStatus: 'CLEAN',
        ci: 'passing',
        checksTotal: 12,
        checksFailing: 0,
        at: now - 1_000,
      },
      brief: {
        title: 'Token migration',
        summary: 'Migrating the design-system colour tokens to Tailwind v4 @theme.',
        phase: 'simplification',
        needsYou: false,
        needsReason: null,
        lastAsk: 'Migrate color tokens to Tailwind v4 @theme.',
        nextStep: 'Run the build to confirm the token migration compiles cleanly.',
        at: now - 1_000,
        state: 'ready',
      },
    }),
    base({
      id: 'd-idle',
      tool: 'codex',
      runtime: 'terminal',
      worktree: 'infra',
      branch: null,
      job: 'Terraform plan review for staging',
      status: 'idle',
      liveness: 'idle',
      livenessBasis: 'mtime 6m, process alive',
      lastAction: 'Read main.tf',
      idleSec: 360,
      updatedAt: now - 360_000,
      tokens: 12_400,
      order: -3000,
      // Brief still being synthesized — card shows the shimmer.
      brief: {
        title: '',
        summary: '',
        phase: null,
        needsYou: false,
        needsReason: null,
        lastAsk: null,
        nextStep: null,
        at: now - 360_000,
        state: 'pending',
      },
    }),
    base({
      id: 'e-done',
      tool: 'claude',
      runtime: 'terminal',
      worktree: 'docs-site',
      branch: 'feat/search',
      job: 'Add full-text search to the docs',
      status: 'done',
      liveness: 'ended',
      livenessBasis: 'no process, mtime 41m',
      lastMessage: 'Done — search is wired up and tests pass.',
      idleSec: 2460,
      updatedAt: now - 2_460_000,
      prLink: 'https://github.com/acme/docs-site/pull/77',
      pr: {
        number: 77,
        url: 'https://github.com/acme/docs-site/pull/77',
        title: 'Add full-text search to the docs',
        state: 'MERGED',
        isDraft: false,
        baseRef: 'main',
        conflicts: false,
        behindBase: false,
        mergeStateStatus: 'CLEAN',
        ci: 'passing',
        checksTotal: 8,
        checksFailing: 0,
        at: now - 2_460_000,
      },
      tokens: 191_000,
      contextWindow: 200_000,
      order: -2000,
      brief: {
        title: 'Docs search',
        summary: 'Added full-text search to the docs site; PR is open and tests pass.',
        phase: 'release',
        needsYou: false,
        needsReason: null,
        lastAsk: 'Add full-text search to the docs.',
        nextStep: 'Review and merge PR #77.',
        at: now - 2_460_000,
        state: 'ready',
      },
    }),
    base({
      id: 'f-unknown',
      tool: 'codex',
      runtime: 'unknown',
      worktree: 'legacy-monolith',
      branch: 'main',
      job: 'Investigate flaky integration test',
      status: 'unknown',
      liveness: 'unknown',
      livenessBasis: 'no recent activity, cannot probe',
      rawTail: '{"role":"assistant","content":"..."}',
      updatedAt: now - 7_200_000,
      order: -1000,
    }),
    base({
      id: 'g-ended',
      tool: 'claude',
      runtime: 'terminal',
      worktree: 'brand',
      branch: 'main',
      job: 'Review project color palette',
      status: 'done',
      liveness: 'ended',
      livenessBasis: 'no process, mtime 15h',
      lastMessage: 'Palette reviewed; suggested a higher-contrast set.',
      idleSec: 54_000, // 15h
      updatedAt: now - 54_000_000,
      tokens: 42_000,
      contextWindow: 200_000,
      order: 0,
      brief: {
        title: 'Palette review',
        summary: 'Reviewed the project colour palette and proposed higher-contrast values.',
        phase: 'code-review',
        needsYou: false,
        needsReason: null,
        lastAsk: 'Review project color palette.',
        nextStep: 'Apply the proposed palette if you agree with the contrast bump.',
        at: now - 54_000_000,
        state: 'ready',
      },
    }),
  ];

  return { seed, projects: makeMockProjects(seed, now), serverTime: now };
}

/** Mock project/worktree topology so the tabbed UI is demoable without a backend. */
function makeMockProjects(seed: AgentRecord[], now: number): Project[] {
  const find = (id: string) => seed.find((a) => a.id === id)!;
  const ref = (a: AgentRecord): SlotAgentRef => ({
    id: a.id,
    tool: a.tool,
    status: a.status,
    liveness: a.liveness,
    job: a.jobName?.trim() || a.job,
    needsYou: a.brief?.needsYou ?? (a.status === 'waiting' || a.status === 'error'),
  });
  const slot = (over: Partial<WorktreeSlot> & { path: string }): WorktreeSlot => ({
    branch: 'main',
    isPrimary: false,
    exists: true,
    detached: false,
    bare: false,
    dirty: false,
    ahead: 0,
    behind: 0,
    pr: null,
    agent: null,
    sessionsCount: 0,
    ...over,
  });
  const wait = find('a-wait');
  const busy = find('c-busy');
  const err = find('b-err');

  return [
    {
      id: 'p-mc',
      name: 'mission-control',
      root: '/Users/dev/mission-control',
      origin: 'discovered',
      at: now,
      slots: [
        slot({ path: '/Users/dev/mission-control', branch: 'master', isPrimary: true, dirty: true, ahead: 3, behind: 0 }),
        slot({ path: '/Users/dev/mc-wt/feat-ui', branch: 'feat/ui', dirty: true, ahead: 12, agent: ref(wait), sessionsCount: 1, pr: wait.pr }),
        slot({ path: '/Users/dev/mc-wt/experiment', branch: 'spike/virtualized', dirty: false }),
      ],
    },
    {
      id: 'p-ds',
      name: 'design-system',
      root: '/Users/dev/design-system',
      origin: 'discovered',
      at: now,
      slots: [
        slot({ path: '/Users/dev/design-system', branch: 'main', isPrimary: true }),
        slot({ path: '/Users/dev/ds-wt/tokens', branch: 'chore/tokens', dirty: true, ahead: 4, agent: ref(busy), sessionsCount: 1, pr: busy.pr }),
      ],
    },
    {
      id: 'p-api',
      name: 'api-gateway',
      root: '/Users/dev/api-gateway',
      origin: 'manual',
      at: now,
      slots: [
        slot({ path: '/Users/dev/api-gateway', branch: 'master', isPrimary: true }),
        slot({ path: '/Users/dev/api-wt/timeout', branch: 'fix/timeout', dirty: true, ahead: 2, behind: 5, agent: ref(err), sessionsCount: 1, pr: err.pr }),
      ],
    },
  ];
}

function startMockTicker(
  _setAgents: React.Dispatch<React.SetStateAction<AgentRecord[]>>,
  setServerTime: React.Dispatch<React.SetStateAction<number>>,
): ReturnType<typeof setInterval> {
  // Only advance the server clock so idle/ended timers tick. We deliberately do
  // NOT churn agent records — no per-few-seconds reshuffle, no flashing.
  return setInterval(() => {
    setServerTime(Date.now());
  }, 4000);
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentRecord } from '../shared/types';
import { useAgentStream, updateMeta, addProject, setActiveProject } from './sse';
import { TopBar, type Filters } from './components/TopBar';
import { Cards } from './components/Cards';
import { ProjectTabs, type ProjectStat } from './components/ProjectTabs';
import { SlotGrid, type SlotEntry } from './components/SlotGrid';
import { DetailDrawer } from './components/DetailDrawer';
import { needsYou, sortAgents } from './lib/format';

const STALE_WINDOW_MS = 24 * 60 * 60 * 1000;

const DEFAULT_FILTERS: Filters = {
  tool: 'all',
  liveOnly: false,
  recent24h: true, // default ON
  query: '',
};

type MetaBody = {
  pinned?: boolean;
  jobName?: string | null;
  dismissed?: boolean;
  notes?: string | null;
  order?: number;
};

export function App() {
  const { agents, projects, loading, connection, serverTime } = useAgentStream();

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Which tab is in view: the 'all' overview, or a project's id.
  const [activeTab, setActiveTab] = useState<string>('all');

  // Optimistic meta overlay: id -> partial record we applied locally before the
  // server echoes the update back via SSE. Cleared once the server agrees.
  const [optimistic, setOptimistic] = useState<Record<string, MetaBody>>({});

  // 1s tick so idle timers / time-ago advance live without server traffic.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const now = useMemo(() => Date.now(), [tick]);

  // Merge optimistic meta over the streamed records.
  const merged = useMemo<AgentRecord[]>(() => {
    if (Object.keys(optimistic).length === 0) return agents;
    return agents.map((a) => {
      const o = optimistic[a.id];
      return o ? { ...a, ...o } : a;
    });
  }, [agents, optimistic]);

  // Drop optimistic entries once the server's record matches them.
  useEffect(() => {
    setOptimistic((prev) => {
      const keys = Object.keys(prev);
      if (keys.length === 0) return prev;
      let changed = false;
      const next: Record<string, MetaBody> = {};
      for (const id of keys) {
        const server = agents.find((a) => a.id === id);
        const o = prev[id];
        if (!server || !o) {
          next[id] = o as MetaBody;
          continue;
        }
        const settled = (Object.keys(o) as (keyof MetaBody)[]).every(
          (k) => server[k as keyof AgentRecord] === o[k],
        );
        if (settled) {
          changed = true;
        } else {
          next[id] = o;
        }
      }
      return changed ? next : prev;
    });
  }, [agents]);

  // Filter + sort.
  const visible = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    const filtered = merged.filter((a) => {
      if (a.dismissed) return false;
      if (filters.tool !== 'all' && a.tool !== filters.tool) return false;
      if (filters.liveOnly && a.liveness !== 'live') return false;
      if (filters.recent24h && now - a.updatedAt > STALE_WINDOW_MS) {
        return false;
      }
      if (q) {
        const hay = [
          a.brief?.summary ?? '',
          a.jobName ?? '',
          a.job ?? '',
          a.worktree ?? '',
          a.branch ?? '',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return sortAgents(filtered);
  }, [merged, filters, now]);

  // Live-ticking idle seconds, derived from updatedAt. Computed over ALL agents
  // (not just `visible`) so slot agents hidden from the All tab still get a value.
  const idleByAgent = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const a of merged) {
      out[a.id] = Math.max(0, Math.floor((now - a.updatedAt) / 1000));
    }
    return out;
  }, [merged, now]);

  // id -> agent over `merged`, so optimistic pin/rename reach slot cards too.
  const agentById = useMemo(() => {
    const m = new Map<string, AgentRecord>();
    for (const a of merged) m.set(a.id, a);
    return m;
  }, [merged]);

  const activeProject = useMemo(
    () => (activeTab === 'all' ? null : projects.find((p) => p.id === activeTab) ?? null),
    [projects, activeTab],
  );

  // The active project's slots joined to their agents, ordered primary-first then
  // by path (stable — never reshuffles on status change).
  const projectSlots = useMemo<SlotEntry[]>(() => {
    if (!activeProject) return [];
    return activeProject.slots
      .map((slot) => ({ slot, agent: slot.agent ? agentById.get(slot.agent.id) ?? null : null }))
      .sort((a, b) => {
        if (a.slot.isPrimary !== b.slot.isPrimary) return a.slot.isPrimary ? -1 : 1;
        return a.slot.path < b.slot.path ? -1 : a.slot.path > b.slot.path ? 1 : 0;
      });
  }, [activeProject, agentById]);

  // Per-project tab counts (occupied / need-you / dirty).
  const projectStats = useMemo<Record<string, ProjectStat>>(() => {
    const out: Record<string, ProjectStat> = {};
    for (const p of projects) {
      let occupied = 0;
      let needY = 0;
      let dirty = 0;
      for (const slot of p.slots) {
        if (slot.dirty) dirty++;
        if (slot.agent) {
          occupied++;
          const a = agentById.get(slot.agent.id);
          if ((a && needsYou(a)) || slot.agent.needsYou) needY++;
        }
      }
      out[p.id] = { occupied, needYou: needY, dirty };
    }
    return out;
  }, [projects, agentById]);

  // Header counts (over non-dismissed agents in the active window).
  const counts = useMemo(() => {
    const inWindow = merged.filter(
      (a) =>
        !a.dismissed &&
        (!filters.recent24h || now - a.updatedAt <= STALE_WINDOW_MS),
    );
    return {
      total: inWindow.length,
      needYou: inWindow.filter((a) => needsYou(a)).length,
      live: inWindow.filter((a) => a.liveness === 'live').length,
    };
  }, [merged, filters.recent24h, now]);

  const selected = useMemo(
    () => merged.find((a) => a.id === selectedId) ?? null,
    [merged, selectedId],
  );

  // If the selected agent disappears (removed / dismissed), close the drawer.
  useEffect(() => {
    if (selectedId && !merged.some((a) => a.id === selectedId)) {
      setSelectedId(null);
    }
  }, [merged, selectedId]);

  // If the active project tab disappears, fall back to the All overview.
  useEffect(() => {
    if (activeTab !== 'all' && !projects.some((p) => p.id === activeTab)) {
      setActiveTab('all');
    }
  }, [projects, activeTab]);

  // Hint the server which project is in view (bounds empty-slot PR polling).
  useEffect(() => {
    setActiveProject(activeTab === 'all' ? null : activeTab);
  }, [activeTab]);

  const handleMeta = useCallback((id: string, body: MetaBody) => {
    // Optimistic apply.
    setOptimistic((prev) => ({ ...prev, [id]: { ...prev[id], ...body } }));
    void updateMeta(id, body).catch(() => {
      // On failure, drop the optimistic overlay so the server truth wins.
      setOptimistic((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });
  }, []);

  // Reorder via drag: drop `draggedId` at slot `targetIndex` within the visible
  // list. Compute a new `order` as the midpoint between the new neighbours'
  // orders (orders are large floats, so midpoints never collide); at the very
  // start/end, step out by 1000. Apply optimistically + persist.
  const handleReorder = useCallback(
    (draggedId: string, targetIndex: number) => {
      const without = visible.filter((a) => a.id !== draggedId);
      const clamped = Math.max(0, Math.min(targetIndex, without.length));
      const before: AgentRecord | undefined = without[clamped - 1];
      const after: AgentRecord | undefined = without[clamped];

      let newOrder: number;
      if (before && after) {
        newOrder = (before.order + after.order) / 2; // midpoint between neighbours
      } else if (after) {
        newOrder = after.order - 1000; // dropped at the very start
      } else if (before) {
        newOrder = before.order + 1000; // dropped at the very end
      } else {
        newOrder = 0; // only card
      }

      const current = visible.find((a) => a.id === draggedId);
      if (current && current.order === newOrder) return;
      handleMeta(draggedId, { order: newOrder });
    },
    [visible, handleMeta],
  );

  const handleChangeFilters = useCallback((next: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...next }));
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS, recent24h: false });
  }, []);

  const filteredEmpty =
    !loading &&
    visible.length === 0 &&
    merged.some((a) => !a.dismissed);

  return (
    <div className="relative flex h-full flex-col">
      <TopBar
        filters={filters}
        onChange={handleChangeFilters}
        total={counts.total}
        needYou={counts.needYou}
        live={counts.live}
        connection={connection}
        filtersDisabled={activeTab !== 'all'}
      />

      <ProjectTabs
        projects={projects}
        stats={projectStats}
        active={activeTab}
        onSelect={setActiveTab}
        onAddProject={addProject}
      />

      <main className="relative flex min-h-0 flex-1 flex-col">
        {activeTab === 'all' ? (
          <Cards
            agents={visible}
            selectedId={selectedId}
            idleByAgent={idleByAgent}
            loading={loading}
            filteredEmpty={filteredEmpty}
            onSelect={setSelectedId}
            onReorder={handleReorder}
            onClearFilters={handleClearFilters}
          />
        ) : (
          <SlotGrid
            project={activeProject}
            slots={projectSlots}
            selectedId={selectedId}
            idleByAgent={idleByAgent}
            onSelect={setSelectedId}
          />
        )}
      </main>

      <DetailDrawer
        agent={selected}
        serverTime={serverTime}
        onClose={() => setSelectedId(null)}
        onMeta={handleMeta}
      />
    </div>
  );
}

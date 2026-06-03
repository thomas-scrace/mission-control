import type { AgentRecord } from '../../shared/types';
import { AgentCard } from './AgentCard';
import { Swimlanes, Lane } from './Swimlanes';
import { agentLane } from '../lib/format';

interface Props {
  agents: AgentRecord[];
  selectedId: string | null;
  /** Per-id live idle seconds, recomputed each tick from updatedAt. */
  idleByAgent: Record<string, number>;
  loading: boolean;
  /** True when there are agents in total but the active filters hid them all. */
  filteredEmpty: boolean;
  onSelect: (id: string) => void;
  /** Manually (un)block a card by dragging it to/from the Blocked lane. */
  onBlock: (id: string, blocked: boolean) => void;
  /** Hide an agent (tucks it behind the Hidden tab). */
  onHide: (id: string, hidden: boolean) => void;
  onClearFilters: () => void;
}

/** The "All" overview: agents split into Blocked / Running / Needs me / Inactive lanes. */
export function Cards({ agents, selectedId, idleByAgent, loading, filteredEmpty, onSelect, onBlock, onHide, onClearFilters }: Props) {
  const cardFor = (agent: AgentRecord) => (
    <AgentCard key={agent.id} agent={agent} selected={agent.id === selectedId} idleSec={idleByAgent[agent.id] ?? null} onSelect={onSelect} onHide={onHide} />
  );

  // Manually-blocked first; the rest by the three statuses (the All tab has no "available"
  // worktrees, so its third status lane is "Inactive" — sessions whose process is gone).
  const blocked = agents.filter((a) => a.blocked);
  const rest = agents.filter((a) => !a.blocked);
  const running = rest.filter((a) => agentLane(a) === 'running');
  const needsMe = rest.filter((a) => agentLane(a) === 'needs-me');
  const inactive = rest.filter((a) => agentLane(a) === 'inactive');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {loading ? (
        <LoadingState />
      ) : agents.length === 0 ? (
        filteredEmpty ? (
          <NoMatchState onClearFilters={onClearFilters} />
        ) : (
          <EmptyState />
        )
      ) : (
        <Swimlanes>
          <Lane label="Blocked" count={blocked.length} tone="blocked" first onDropCard={(id) => onBlock(id, true)} emptyHint="Drag a card here to park it as blocked.">
            {blocked.map(cardFor)}
          </Lane>
          {running.length > 0 && (
            <Lane label="Running" count={running.length} tone="running" onDropCard={(id) => onBlock(id, false)}>
              {running.map(cardFor)}
            </Lane>
          )}
          {needsMe.length > 0 && (
            <Lane label="Needs me" count={needsMe.length} tone="needs" onDropCard={(id) => onBlock(id, false)}>
              {needsMe.map(cardFor)}
            </Lane>
          )}
          {inactive.length > 0 && (
            <Lane label="Inactive" count={inactive.length} tone="inactive" onDropCard={(id) => onBlock(id, false)}>
              {inactive.map(cardFor)}
            </Lane>
          )}
        </Swimlanes>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-32 text-ink-faint">
      <span
        className="mc-spin inline-block h-6 w-6 rounded-full border-2 border-hairline border-t-accent"
        aria-hidden
      />
      <span className="text-sm tracking-wide">Acquiring signal…</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-32 text-center">
      <div className="text-2xl">🛰️</div>
      <div className="text-sm font-medium text-ink-dim">No agents yet</div>
      <p className="max-w-sm text-xs leading-relaxed text-ink-faint">
        Start a Claude Code or Codex session and it will appear here
        automatically. Mission Control watches your transcripts in real time.
      </p>
    </div>
  );
}

function NoMatchState({ onClearFilters }: { onClearFilters: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-32 text-center">
      <div className="text-sm font-medium text-ink-dim">
        No agents match the current filters
      </div>
      <button
        type="button"
        onClick={onClearFilters}
        className="rounded border border-hairline-bright px-3 py-1.5 text-xs text-ink-dim transition-colors hover:border-accent/50 hover:text-accent"
      >
        Clear filters
      </button>
    </div>
  );
}

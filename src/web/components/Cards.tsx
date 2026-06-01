import { useCallback, useState } from 'react';
import type { AgentRecord } from '../../shared/types';
import { AgentCard } from './AgentCard';

interface Props {
  agents: AgentRecord[];
  selectedId: string | null;
  /** Per-id live idle seconds, recomputed each tick from updatedAt. */
  idleByAgent: Record<string, number>;
  loading: boolean;
  /** True when there are agents in total but the active filters hid them all. */
  filteredEmpty: boolean;
  onSelect: (id: string) => void;
  /** Drop `draggedId` at slot `targetIndex` in the current visible order. */
  onReorder: (draggedId: string, targetIndex: number) => void;
  onClearFilters: () => void;
}

/** Which edge of a card the drop indicator is shown on. */
type DropEdge = 'before' | 'after' | null;

/**
 * A responsive grid of agent cards with dependency-free HTML5 drag-to-reorder.
 * Only the grip handle inside each card is draggable, so dragging never fights
 * the card's click-to-open. A crisp accent indicator marks where a card lands.
 */
export function Cards({
  agents,
  selectedId,
  idleByAgent,
  loading,
  filteredEmpty,
  onSelect,
  onReorder,
  onClearFilters,
}: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // The card currently hovered as a drop target, and which edge.
  const [over, setOver] = useState<{ id: string; edge: DropEdge }>({
    id: '',
    edge: null,
  });

  const clearDrag = useCallback(() => {
    setDraggingId(null);
    setOver({ id: '', edge: null });
  }, []);

  const handleDragStart = useCallback((id: string) => {
    setDraggingId(id);
  }, []);

  const handleDragOver = useCallback(
    (id: string, edge: Exclude<DropEdge, null>) => {
      setOver((prev) =>
        prev.id === id && prev.edge === edge ? prev : { id, edge },
      );
    },
    [],
  );

  const handleDrop = useCallback(
    (targetId: string, edge: Exclude<DropEdge, null>) => {
      const dragged = draggingId;
      clearDrag();
      if (!dragged || dragged === targetId) return;

      const targetIdx = agents.findIndex((a) => a.id === targetId);
      if (targetIdx === -1) return;
      // Index in the list (which still includes the dragged card). App's handler
      // removes the dragged card before resolving neighbours, so we pass the
      // slot in the *full* visible list: before the target, or after it.
      const targetIndex = edge === 'before' ? targetIdx : targetIdx + 1;
      onReorder(dragged, targetIndex);
    },
    [agents, draggingId, onReorder, clearDrag],
  );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {loading ? (
        <LoadingState />
      ) : agents.length === 0 ? (
        filteredEmpty ? (
          <NoMatchState onClearFilters={onClearFilters} />
        ) : (
          <EmptyState />
        )
      ) : (
        <div className="mc-fade-in grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-6 p-6 sm:gap-7 sm:p-8">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              selected={agent.id === selectedId}
              idleSec={idleByAgent[agent.id] ?? null}
              dragging={draggingId === agent.id}
              dropEdge={
                draggingId && over.id === agent.id && draggingId !== agent.id
                  ? over.edge
                  : null
              }
              onSelect={onSelect}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={clearDrag}
            />
          ))}
        </div>
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

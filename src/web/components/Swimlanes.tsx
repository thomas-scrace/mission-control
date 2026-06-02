import { useState, type ReactNode } from 'react';

type Tone = 'running' | 'needs' | 'available' | 'inactive' | 'blocked';

/** A horizontal row of vertical lanes (kanban-style). Lanes scroll independently;
 *  the row scrolls horizontally if they overflow. */
export function Swimlanes({ children }: { children: ReactNode }) {
  return <div className="mc-fade-in flex min-h-0 flex-1 overflow-x-auto">{children}</div>;
}

/** One vertical lane: a fixed-width column with a header and an independently
 *  scrolling stack of cards. Pass `onDropCard` to make it a drop target — dragging
 *  a card's handle onto it calls back with the agent id (used for the Blocked lane). */
export function Lane({
  label,
  count,
  tone,
  first = false,
  onDropCard,
  emptyHint,
  children,
}: {
  label: string;
  count: number;
  tone: Tone;
  first?: boolean;
  onDropCard?: (agentId: string) => void;
  emptyHint?: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const color = tone === 'running' ? 'text-live' : tone === 'needs' ? 'text-waiting' : tone === 'blocked' ? 'text-error' : 'text-ink-faint';
  const dot = tone === 'running' ? 'bg-live' : tone === 'needs' ? 'bg-waiting' : tone === 'blocked' ? 'bg-error' : null;

  const drop = onDropCard
    ? {
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (!over) setOver(true);
        },
        onDragLeave: () => setOver(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setOver(false);
          const id = e.dataTransfer.getData('text/plain');
          if (id) onDropCard(id);
        },
      }
    : {};

  return (
    <section
      {...drop}
      className={[
        'flex w-[460px] shrink-0 flex-col transition-colors',
        first ? '' : 'border-l border-hairline',
        over ? 'bg-accent/[0.06] ring-1 ring-inset ring-accent/30' : '',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 px-5 pb-2 pt-4">
        {dot && <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot} ${tone === 'running' ? 'mc-dot-live' : ''}`} aria-hidden />}
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${color}`}>{label}</span>
        <span className="text-[11px] tabular-nums text-ink-faint">{count}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-1">
        {count === 0 && emptyHint ? (
          <p className="rounded-lg border border-dashed border-hairline px-3 py-6 text-center text-[12px] text-ink-faint">{emptyHint}</p>
        ) : (
          <div className="flex flex-col gap-5">{children}</div>
        )}
      </div>
    </section>
  );
}

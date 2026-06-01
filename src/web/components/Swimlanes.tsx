import type { ReactNode } from 'react';

type Tone = 'live' | 'idle' | 'available';

/** A horizontal row of vertical lanes (kanban-style). Lanes scroll independently;
 *  the row scrolls horizontally if they overflow. */
export function Swimlanes({ children }: { children: ReactNode }) {
  return <div className="mc-fade-in flex min-h-0 flex-1 overflow-x-auto">{children}</div>;
}

/** One vertical lane: a fixed-width column with a header and an independently
 *  scrolling stack of cards. A left hairline separates it from the previous lane. */
export function Lane({
  label,
  count,
  tone,
  first = false,
  children,
}: {
  label: string;
  count: number;
  tone: Tone;
  first?: boolean;
  children: ReactNode;
}) {
  const color = tone === 'live' ? 'text-live' : 'text-ink-faint';
  return (
    <section className={`flex w-[400px] shrink-0 flex-col ${first ? '' : 'border-l border-hairline'}`}>
      <div className="flex items-center gap-2 px-5 pb-2 pt-4">
        {tone === 'live' && <span className="mc-dot-live inline-block h-1.5 w-1.5 rounded-full bg-live" aria-hidden />}
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${color}`}>{label}</span>
        <span className="text-[11px] tabular-nums text-ink-faint">{count}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-1">
        <div className="flex flex-col gap-5">{children}</div>
      </div>
    </section>
  );
}

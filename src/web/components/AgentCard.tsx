import { memo } from 'react';
import type { AgentRecord } from '../../shared/types';
import { focusAgent } from '../sse';
import { PrChip } from './PrStatus';
import { CardFooter, CardHeader, NeedsYouBanner, ReadyBody, SynthesizingBody } from './cardParts';
import { briefPending, isErrorTone, livenessLabel, needsYou, titleText } from '../lib/format';

type DropEdge = 'before' | 'after' | null;

interface Props {
  agent: AgentRecord;
  selected: boolean;
  /** Live-ticking idle seconds (recomputed from updatedAt each tick). */
  idleSec: number | null;
  /** True while THIS card is the one being dragged. */
  dragging: boolean;
  /** When set, draw a drop indicator on this edge of the card. */
  dropEdge: DropEdge;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragOver: (id: string, edge: Exclude<DropEdge, null>) => void;
  onDrop: (id: string, edge: Exclude<DropEdge, null>) => void;
  onDragEnd: () => void;
}

/**
 * One calm, focused agent card for the "All" overview tab. The eye should land on
 * exactly two things: (1) anything that NEEDS YOU, and (2) the one-line summary.
 * Everything else recedes. Dense detail lives in the drawer. Presentational pieces
 * are shared with the per-project SlotCard via cardParts.
 */
export const AgentCard = memo(function AgentCard({
  agent,
  selected,
  idleSec,
  dragging,
  dropEdge,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: Props) {
  const wants = needsYou(agent);
  const error = isErrorTone(agent);
  const pending = briefPending(agent);
  const live = livenessLabel(agent, idleSec);

  const ended = !wants && live.tone === 'ended';
  const idleDim = !wants && live.tone === 'idle';

  const tone = wants
    ? error
      ? 'border-error/45 mc-accent-l-error mc-glow-error'
      : 'border-waiting/45 mc-accent-l-amber mc-glow-amber'
    : 'border-hairline hover:border-accent/50';

  const dropCls =
    dropEdge === 'before' ? 'mc-drop-before' : dropEdge === 'after' ? 'mc-drop-after' : '';

  const edgeFromEvent = (e: React.DragEvent<HTMLElement>): 'before' | 'after' => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
  };

  return (
    <article
      role="button"
      tabIndex={0}
      aria-selected={selected}
      aria-label={`Open ${titleText(agent)} — focus its window`}
      onClick={() => void focusAgent(agent.id).catch(() => {})}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void focusAgent(agent.id).catch(() => {});
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onDragOver(agent.id, edgeFromEvent(e));
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(agent.id, edgeFromEvent(e));
      }}
      className={[
        'group relative flex flex-col gap-4 rounded-xl border bg-surface p-6',
        'shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_4px_16px_-8px_rgba(0,0,0,0.7)]',
        'cursor-pointer outline-none transition-[border-color,background-color,opacity,box-shadow] duration-200',
        'hover:bg-surface-2',
        'focus-visible:ring-1 focus-visible:ring-accent/60',
        tone,
        ended ? 'opacity-60 saturate-[0.45]' : '',
        idleDim && !ended ? 'opacity-[0.88]' : '',
        selected ? 'ring-1 ring-accent/60' : '',
        dragging ? 'mc-dragging' : '',
        dropCls,
      ].join(' ')}
    >
      <CardHeader agent={agent} onSelect={onSelect} onDragStart={onDragStart} onDragEnd={onDragEnd} />

      {wants && <NeedsYouBanner agent={agent} error={error} />}

      {pending ? <SynthesizingBody agent={agent} /> : <ReadyBody agent={agent} />}

      {agent.pr && <PrChip pr={agent.pr} />}

      <CardFooter live={live} />
    </article>
  );
});

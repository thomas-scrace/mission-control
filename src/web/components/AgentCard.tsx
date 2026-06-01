import { memo } from 'react';
import type { AgentRecord } from '../../shared/types';
import { PrChip } from './PrStatus';
import {
  CARD_INTERACTIVE,
  CARD_SHELL,
  CardFooter,
  CardHeader,
  NeedsYouBanner,
  ReadyBody,
  SynthesizingBody,
  cardDimClasses,
  cardToneClass,
  focusCardProps,
} from './cardParts';
import { WaitingExchange } from './WaitingExchange';
import { briefPending, isErrorTone, livenessLabel, needsYou } from '../lib/format';

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

  const dropCls =
    dropEdge === 'before' ? 'mc-drop-before' : dropEdge === 'after' ? 'mc-drop-after' : '';

  // Cards stack vertically in a lane, so the drop edge is top/bottom.
  const edgeFromEvent = (e: React.DragEvent<HTMLElement>): 'before' | 'after' => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  };

  return (
    <article
      {...focusCardProps(agent)}
      aria-selected={selected}
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
        CARD_SHELL,
        CARD_INTERACTIVE,
        cardToneClass(wants, error),
        ...cardDimClasses(wants, live),
        selected ? 'ring-1 ring-accent/60' : '',
        dragging ? 'mc-dragging' : '',
        dropCls,
      ].join(' ')}
    >
      <CardHeader agent={agent} onSelect={onSelect} onDragStart={onDragStart} onDragEnd={onDragEnd} />

      {wants && <NeedsYouBanner agent={agent} error={error} />}

      {pending ? <SynthesizingBody agent={agent} /> : <ReadyBody agent={agent} />}

      {/* Matches the project-tab slot cards: the You/Agent exchange when it needs you. */}
      {wants && !error && <WaitingExchange agent={agent} />}

      {agent.pr && <PrChip pr={agent.pr} />}

      <CardFooter live={live} />
    </article>
  );
});

import { memo } from 'react';
import type { AgentRecord } from '../../shared/types';
import { PrChip } from './PrStatus';
import { WaitingExchange } from './WaitingExchange';
import {
  CARD_INTERACTIVE,
  CARD_SHELL,
  CardTitle,
  DetailsButton,
  GripIcon,
  MetaRow,
  NextLine,
  SynthesizingBody,
  WorkChecks,
  cardDimClasses,
  cardToneClass,
  focusCardProps,
} from './cardParts';
import { agentLane, briefPending, clean, isErrorTone, livenessLabel, needsYou } from '../lib/format';

type DropEdge = 'before' | 'after' | null;

interface Props {
  agent: AgentRecord;
  selected: boolean;
  /** Live-ticking idle seconds (unused for display now; kept for dim/liveness tone). */
  idleSec: number | null;
  dragging: boolean;
  dropEdge: DropEdge;
  onSelect: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragOver: (id: string, edge: Exclude<DropEdge, null>) => void;
  onDrop: (id: string, edge: Exclude<DropEdge, null>) => void;
  onDragEnd: () => void;
}

/**
 * One agent card for the "All" overview tab. Same decluttered layout as the
 * per-project SlotCard (shared cardParts), with a drag handle for reordering.
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
  const pending = briefPending(agent);
  const needsMe = agentLane(agent) === 'needs-me';
  const live = livenessLabel(agent, idleSec);

  const dropCls = dropEdge === 'before' ? 'mc-drop-before' : dropEdge === 'after' ? 'mc-drop-after' : '';

  // Cards stack vertically in a lane, so the drop edge is top/bottom.
  const edgeFromEvent = (e: React.DragEvent<HTMLElement>): 'before' | 'after' => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  };

  const grip = (
    <span
      className="mc-grip -ml-1 shrink-0 rounded p-0.5 text-ink-faint transition-colors hover:text-ink-dim"
      draggable
      title="Drag to reorder"
      aria-label="Drag to reorder"
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', agent.id);
        onDragStart(agent.id);
      }}
      onDragEnd={(e) => {
        e.stopPropagation();
        onDragEnd();
      }}
    >
      <GripIcon />
    </span>
  );

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
        cardToneClass(wants, isErrorTone(agent)),
        ...cardDimClasses(wants, live),
        selected ? 'ring-1 ring-accent/60' : '',
        dragging ? 'mc-dragging' : '',
        dropCls,
      ].join(' ')}
    >
      <MetaRow
        label={clean(agent.worktree) ?? '—'}
        labelTitle={agent.cwd}
        branch={agent.branch}
        dirty={null}
        tool={agent.tool}
        grip={grip}
      />

      {pending ? <SynthesizingBody agent={agent} /> : <CardTitle agent={agent} />}

      {agent.pr && <PrChip pr={agent.pr} />}

      {!pending && needsMe && <WaitingExchange agent={agent} />}
      {!pending && <WorkChecks brief={agent.brief} />}
      {!pending && <NextLine brief={agent.brief} />}

      <DetailsButton id={agent.id} onSelect={onSelect} />
    </article>
  );
});

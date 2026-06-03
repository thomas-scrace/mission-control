import { memo } from 'react';
import type { AgentRecord } from '../../shared/types';
import { PrChip } from './PrStatus';
import { WaitingExchange } from './WaitingExchange';
import {
  CARD_INTERACTIVE,
  CARD_SHELL,
  CardActions,
  CardTitle,
  MetaRow,
  NextLine,
  SynthesizingBody,
  WorkChecks,
  cardDimClasses,
  cardToneClass,
  focusCardProps,
} from './cardParts';
import { agentLane, briefPending, clean, isErrorTone, livenessLabel, needsYou } from '../lib/format';

interface Props {
  agent: AgentRecord;
  selected: boolean;
  /** Live-ticking idle seconds (kept for the liveness/dim tone). */
  idleSec: number | null;
  onSelect: (id: string) => void;
  /** Hide (or, on the Hidden tab, unhide) this agent. */
  onHide: (id: string, hidden: boolean) => void;
}

/**
 * One agent card for the "All" overview tab (and the Hidden tab). Same decluttered
 * layout as the per-project SlotCard (shared cardParts). Its drag handle lets you
 * drag it to a lane (e.g. Blocked) — the lanes are the drop targets.
 */
export const AgentCard = memo(function AgentCard({ agent, selected, idleSec, onSelect, onHide }: Props) {
  const wants = needsYou(agent);
  // Hidden agents aren't synthesized, so never show them the "Synthesizing…" shimmer.
  const pending = briefPending(agent) && !agent.dismissed;
  const needsMe = agentLane(agent) === 'needs-me';
  const live = livenessLabel(agent, idleSec);

  return (
    <article
      {...focusCardProps(agent)}
      aria-selected={selected}
      className={[
        CARD_SHELL,
        CARD_INTERACTIVE,
        cardToneClass(wants, isErrorTone(agent)),
        ...cardDimClasses(wants, live),
        selected ? 'ring-1 ring-accent/60' : '',
      ].join(' ')}
    >
      <MetaRow
        label={clean(agent.worktree) ?? '—'}
        labelTitle={agent.cwd}
        branch={agent.branch}
        dirty={null}
        tool={agent.tool}
        dragId={agent.id}
      />

      {pending ? <SynthesizingBody agent={agent} /> : <CardTitle agent={agent} />}

      {agent.pr && <PrChip pr={agent.pr} />}

      {!pending && needsMe && <WaitingExchange agent={agent} />}
      {!pending && <WorkChecks agent={agent} />}
      {!pending && <NextLine brief={agent.brief} />}

      <CardActions id={agent.id} hidden={agent.dismissed} onHide={onHide} onSelect={onSelect} />
    </article>
  );
});

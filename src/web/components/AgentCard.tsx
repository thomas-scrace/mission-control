import { memo } from 'react';
import type { AgentRecord } from '../../shared/types';
import { PrChip } from './PrStatus';
import { WaitingExchange } from './WaitingExchange';
import {
  CARD_INTERACTIVE,
  CARD_SHELL,
  CardTitle,
  DetailsButton,
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
}

/**
 * One agent card for the "All" overview tab. Same decluttered layout as the
 * per-project SlotCard (shared cardParts). Its drag handle lets you drag it to a
 * lane (e.g. Blocked) — the lanes are the drop targets.
 */
export const AgentCard = memo(function AgentCard({ agent, selected, idleSec, onSelect }: Props) {
  const wants = needsYou(agent);
  const pending = briefPending(agent);
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
      {!pending && <WorkChecks brief={agent.brief} />}
      {!pending && <NextLine brief={agent.brief} />}

      <DetailsButton id={agent.id} onSelect={onSelect} />
    </article>
  );
});

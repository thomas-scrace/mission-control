import { memo } from 'react';
import type { AgentRecord, WorktreeSlot } from '../../shared/types';
import { PrChip } from './PrStatus';
import { WaitingExchange } from './WaitingExchange';
import { StartAgentControl } from './StartAgentControl';
import {
  CARD_INTERACTIVE,
  CARD_SHELL,
  CardTitle,
  DetailsButton,
  MetaRow,
  NextLine,
  SynthesizingBody,
  WorkChecks,
  cardToneClass,
  focusCardProps,
} from './cardParts';
import { agentLane, briefPending, isErrorTone, needsYou } from '../lib/format';

interface Props {
  slot: WorktreeSlot;
  /** The joined occupying agent (null = empty slot). */
  agent: AgentRecord | null;
  /** "Worktree N" (project-relative); the real dir name is the hover title. */
  label: string;
  labelTitle: string;
  selected: boolean;
  onSelect: (id: string) => void;
}

/**
 * One worktree "slot" — occupied by an agent or empty/available. Occupied slots
 * click-to-focus the real window; empty slots show a quiet, dashed shell with a
 * Start control. Title near the top; "you asked / agent" only when it needs you.
 */
export const SlotCard = memo(function SlotCard({ slot, agent, label, labelTitle, selected, onSelect }: Props) {
  if (!agent) return <EmptySlotCard slot={slot} label={label} labelTitle={labelTitle} />;

  const wants = needsYou(agent);
  const pending = briefPending(agent);
  const needsMe = agentLane(agent) === 'needs-me';
  const restingBorder = slot.isPrimary ? 'border-hairline-bright' : 'border-hairline';

  return (
    <article
      {...focusCardProps(agent)}
      aria-selected={selected}
      className={[CARD_SHELL, CARD_INTERACTIVE, cardToneClass(wants, isErrorTone(agent), restingBorder), selected ? 'ring-1 ring-accent/60' : ''].join(' ')}
    >
      <MetaRow label={label} labelTitle={labelTitle} branch={slot.branch} dirty={slot.dirty} tool={agent.tool} dragId={agent.id} />

      {pending ? <SynthesizingBody agent={agent} /> : <CardTitle agent={agent} />}

      {slot.pr && <PrChip pr={slot.pr} />}

      {!pending && needsMe && <WaitingExchange agent={agent} />}
      {!pending && <WorkChecks agent={agent} />}
      {!pending && <NextLine brief={agent.brief} />}

      <DetailsButton id={agent.id} onSelect={onSelect} />
    </article>
  );
});

/* ── Empty slot: quiet, dashed, with a Start control ───────────────────── */

function EmptySlotCard({ slot, label, labelTitle }: { slot: WorktreeSlot; label: string; labelTitle: string }) {
  const launchable = slot.exists && !slot.bare;
  const heading = slot.bare ? 'Bare repository' : !slot.exists ? 'Worktree removed' : 'Available';
  return (
    <article
      className={[CARD_SHELL, 'border-dashed', slot.isPrimary ? 'border-hairline-bright' : 'border-hairline', 'bg-surface/40'].join(' ')}
    >
      <MetaRow label={label} labelTitle={labelTitle} branch={slot.branch} dirty={slot.dirty} />
      {slot.pr && <PrChip pr={slot.pr} />}
      <div className="flex flex-1 flex-col justify-between gap-4">
        <p className="text-[16px] font-semibold text-ink-faint">{heading}</p>
        {launchable ? (
          <StartAgentControl worktreePath={slot.path} />
        ) : (
          <span className="text-[12px] text-ink-faint">
            {slot.bare ? 'Bare repos have no working tree to start an agent in.' : 'This worktree directory is gone (prunable).'}
          </span>
        )}
      </div>
    </article>
  );
}

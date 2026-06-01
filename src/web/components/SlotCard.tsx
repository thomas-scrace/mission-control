import { memo } from 'react';
import type { AgentRecord, WorktreeSlot } from '../../shared/types';
import { SlotMeta } from './SlotMeta';
import { WaitingExchange } from './WaitingExchange';
import { StartAgentControl } from './StartAgentControl';
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
import { briefPending, isErrorTone, livenessLabel, needsYou } from '../lib/format';

interface Props {
  slot: WorktreeSlot;
  /** The joined occupying agent (null = empty slot). */
  agent: AgentRecord | null;
  selected: boolean;
  idleSec: number | null;
  onSelect: (id: string) => void;
}

/**
 * One worktree "slot" — occupied by an agent or empty/available. Occupied slots
 * click-to-focus the real window (like AgentCard) and reuse all the shared card
 * parts; empty slots show a quiet, dashed shell with a Start control.
 */
export const SlotCard = memo(function SlotCard({ slot, agent, selected, idleSec, onSelect }: Props) {
  if (!agent) return <EmptySlotCard slot={slot} />;

  const wants = needsYou(agent);
  const error = isErrorTone(agent);
  const pending = briefPending(agent);
  const live = livenessLabel(agent, idleSec);
  const restingBorder = slot.isPrimary ? 'border-hairline-bright' : 'border-hairline';

  return (
    <article
      {...focusCardProps(agent)}
      aria-selected={selected}
      className={[
        CARD_SHELL,
        CARD_INTERACTIVE,
        cardToneClass(wants, error, restingBorder),
        ...cardDimClasses(wants, live),
        selected ? 'ring-1 ring-accent/60' : '',
      ].join(' ')}
    >
      <SlotMeta slot={slot} />
      <div className="h-px bg-hairline/60" aria-hidden />
      <CardHeader agent={agent} onSelect={onSelect} showGrip={false} showLocation={false} />

      {wants && <NeedsYouBanner agent={agent} error={error} />}

      {pending ? <SynthesizingBody agent={agent} /> : <ReadyBody agent={agent} />}

      {/* When it needs you, surface the exchange: what you last said + what it's saying. */}
      {wants && !error && <WaitingExchange agent={agent} />}

      <CardFooter live={live} />
    </article>
  );
});

/* ── Empty slot: quiet, dashed, with a Start control ───────────────────── */

function EmptySlotCard({ slot }: { slot: WorktreeSlot }) {
  const launchable = slot.exists && !slot.bare;
  const heading = slot.bare ? 'Bare repository' : !slot.exists ? 'Worktree removed' : 'Available';
  return (
    <article
      className={[
        CARD_SHELL,
        'border-dashed',
        slot.isPrimary ? 'border-hairline-bright' : 'border-hairline',
        'bg-surface/40',
      ].join(' ')}
    >
      <SlotMeta slot={slot} />
      <div className="flex flex-1 flex-col justify-between gap-4">
        <p className="text-[15px] font-semibold text-ink-faint">{heading}</p>
        {launchable ? (
          <StartAgentControl worktreePath={slot.path} />
        ) : (
          <span className="text-[11px] text-ink-faint">
            {slot.bare ? 'Bare repos have no working tree to start an agent in.' : 'This worktree directory is gone (prunable).'}
          </span>
        )}
      </div>
    </article>
  );
}

import { memo } from 'react';
import type { AgentRecord, WorktreeSlot } from '../../shared/types';
import { focusAgent } from '../sse';
import { SlotMeta } from './SlotMeta';
import { WaitingExchange } from './WaitingExchange';
import { StartAgentControl } from './StartAgentControl';
import { CardFooter, CardHeader, NeedsYouBanner, ReadyBody, SynthesizingBody } from './cardParts';
import { briefPending, isErrorTone, livenessLabel, needsYou, titleText } from '../lib/format';

interface Props {
  slot: WorktreeSlot;
  /** The joined occupying agent (null = empty slot). */
  agent: AgentRecord | null;
  selected: boolean;
  idleSec: number | null;
  onSelect: (id: string) => void;
}

const SHELL =
  'group relative flex flex-col gap-4 rounded-xl border bg-surface p-6 ' +
  'shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_4px_16px_-8px_rgba(0,0,0,0.7)] ' +
  'outline-none transition-[border-color,background-color,opacity,box-shadow] duration-200';

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
  const ended = !wants && live.tone === 'ended';
  const idleDim = !wants && live.tone === 'idle';

  const tone = wants
    ? error
      ? 'border-error/45 mc-accent-l-error mc-glow-error'
      : 'border-waiting/45 mc-accent-l-amber mc-glow-amber'
    : slot.isPrimary
      ? 'border-hairline-bright hover:border-accent/50'
      : 'border-hairline hover:border-accent/50';

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
      className={[
        SHELL,
        'cursor-pointer hover:bg-surface-2 focus-visible:ring-1 focus-visible:ring-accent/60',
        tone,
        ended ? 'opacity-60 saturate-[0.45]' : '',
        idleDim && !ended ? 'opacity-[0.88]' : '',
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
        SHELL,
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

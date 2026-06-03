import type { AgentBrief, AgentRecord, Tool } from '../../shared/types';
import { ToolMark } from './LogoIcons';
import { focusAgent } from '../sse';
import { clean, fallbackLine, titleText, type LivenessLabel } from '../lib/format';

/**
 * Shared, presentational card pieces used by BOTH the All-tab `AgentCard` and the
 * per-project `SlotCard`, so the two never drift. The card is deliberately sparse:
 * worktree identity, a clear title, PR, (for "needs me") the last exchange, the
 * simplify/review checks, the next step, and a Details button — nothing else.
 */

/* ── Shared card shell ─────────────────────────────────────────────────── */

export const CARD_SHELL =
  'group relative flex flex-col gap-3.5 rounded-xl border bg-surface p-7 ' +
  'shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_4px_16px_-8px_rgba(0,0,0,0.7)] ' +
  'outline-none transition-[border-color,background-color,opacity,box-shadow] duration-200';

export const CARD_INTERACTIVE =
  'cursor-pointer hover:bg-surface-2 focus-visible:ring-1 focus-visible:ring-accent/60';

export function cardToneClass(wants: boolean, error: boolean, restingBorder = 'border-hairline'): string {
  if (!wants) return `${restingBorder} hover:border-accent/50`;
  return error
    ? 'border-error/45 mc-accent-l-error mc-glow-error'
    : 'border-waiting/45 mc-accent-l-amber mc-glow-amber';
}

export function cardDimClasses(wants: boolean, live: LivenessLabel): string[] {
  const ended = !wants && live.tone === 'ended';
  return [ended ? 'opacity-60 saturate-[0.45]' : ''];
}

/** Shared props that make a card click/Enter/Space focus the real agent window. */
export function focusCardProps(agent: AgentRecord) {
  const open = () => void focusAgent(agent.id).catch(() => {});
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': `Open ${titleText(agent)} — focus its window`,
    onClick: open,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    },
  };
}

/* ── Top meta row: worktree label, dirty/clean, tool — then branch on its own
 *    line so it's never truncated. ─────────────────────────────────────── */

export function MetaRow({
  label,
  labelTitle,
  branch,
  dirty,
  tool,
  dragId,
}: {
  label: string;
  labelTitle?: string;
  branch: string | null;
  dirty: boolean | null;
  tool?: Tool;
  /** When set, a drag handle that lets you drag this card to a lane (e.g. Blocked). */
  dragId?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[12.5px]">
        {dragId && <DragHandle id={dragId} />}
        <span className="font-medium text-ink-dim" title={labelTitle}>
          {label}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2.5">
          <CommitState dirty={dirty} />
          {tool && <ToolMark tool={tool} size={15} />}
        </span>
      </div>
      {branch && (
        <div className="flex items-center gap-1.5 font-mono text-[12px] text-ink-faint" title={branch}>
          <BranchIcon />
          <span className="break-all">{branch}</span>
        </div>
      )}
    </div>
  );
}

function CommitState({ dirty }: { dirty: boolean | null }) {
  if (dirty == null) return null;
  if (dirty) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-waiting" title="uncommitted changes">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-waiting" aria-hidden />
        dirty
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-done" title="working tree clean">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-done" aria-hidden />
      clean
    </span>
  );
}

/* ── Title — the main thing, near the top, large ───────────────────────── */

export function CardTitle({ agent }: { agent: AgentRecord }) {
  return (
    <p className="text-[21px] font-bold leading-tight tracking-tight text-ink">{titleText(agent)}</p>
  );
}

/* ── Simplify / review checks (replaces the phase stepper) ─────────────── */

export function WorkChecks({ agent }: { agent: AgentRecord }) {
  return (
    <div className="flex items-center gap-2">
      <Check label="Simplified" done={agent.simplified} />
      <Check label="Reviewed" done={agent.reviewed} />
    </div>
  );
}

function Check({ label, done }: { label: string; done: boolean }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium',
        done ? 'border-done/40 bg-done/10 text-done' : 'border-hairline text-ink-faint',
      ].join(' ')}
      title={done ? `${label}: done on the latest work` : `${label}: not run yet`}
    >
      {done ? <CheckIcon /> : <HollowDot />}
      {label}
    </span>
  );
}

/* ── Next step ─────────────────────────────────────────────────────────── */

export function NextLine({ brief }: { brief: AgentBrief | null }) {
  const next = clean(brief?.nextStep ?? null);
  if (!next) return null;
  return (
    <p className="mc-clamp-2 text-[14px] leading-snug text-ink-dim">
      <span className="font-semibold uppercase tracking-wide text-ink-faint">Next: </span>
      {next}
    </p>
  );
}

/* ── Card footer: Hide/Unhide (left) + Details (right) ──────────────────── */

const FOOTER_BTN =
  'inline-flex items-center gap-1.5 rounded-md border border-hairline px-2.5 py-1.5 text-[12px] font-medium text-ink-dim transition-colors hover:border-accent/50 hover:text-accent';

/** Footer used on the All / Hidden tab cards: a Hide (or Unhide) toggle plus Details. */
export function CardActions({
  id,
  hidden,
  onHide,
  onSelect,
}: {
  id: string;
  hidden: boolean;
  onHide: (id: string, hidden: boolean) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mt-auto flex items-center justify-between pt-1">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onHide(id, !hidden);
        }}
        title={hidden ? 'Unhide — return this agent to the board' : 'Hide — tuck this agent behind the Hidden tab'}
        className={FOOTER_BTN}
      >
        {hidden ? <EyeIcon /> : <EyeOffIcon />}
        {hidden ? 'Unhide' : 'Hide'}
      </button>
      <DetailsButtonInner id={id} onSelect={onSelect} />
    </div>
  );
}

/** Details button used standalone on slot cards (its own right-aligned row). */
export function DetailsButton({ id, onSelect }: { id: string; onSelect: (id: string) => void }) {
  return (
    <div className="mt-auto flex justify-end pt-1">
      <DetailsButtonInner id={id} onSelect={onSelect} />
    </div>
  );
}

function DetailsButtonInner({ id, onSelect }: { id: string; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(id);
      }}
      className={FOOTER_BTN}
    >
      <DetailsPanelIcon />
      Details
    </button>
  );
}

/* ── Synthesizing (brief null/pending) ─────────────────────────────────── */

export function SynthesizingBody({ agent }: { agent: AgentRecord }) {
  const fallback = fallbackLine(agent);
  return (
    <div className="flex flex-col gap-3.5">
      <CardTitle agent={agent} />
      {fallback && <p className="mc-clamp-2 text-[13px] leading-snug text-ink-dim">{fallback}</p>}
      <div className="flex items-center gap-1" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="mc-shimmer h-[3px] flex-1" />
        ))}
      </div>
      <span className="text-[11px] tracking-wide text-ink-faint">Synthesizing…</span>
    </div>
  );
}

/* ── Icons ─────────────────────────────────────────────────────────────── */

function BranchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="4" cy="3.5" r="1.6" />
      <circle cx="4" cy="12.5" r="1.6" />
      <circle cx="12" cy="3.5" r="1.6" />
      <path d="M4 5.1v5.8" strokeLinecap="round" />
      <path d="M12 5.1v1.4a3 3 0 0 1-3 3H5.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d="M3.5 8.5 6.5 11.5 12.5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HollowDot() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="8" cy="8" r="5" />
    </svg>
  );
}

function DragHandle({ id }: { id: string }) {
  return (
    <span
      className="mc-grip -ml-1 shrink-0 rounded p-0.5 text-ink-faint transition-colors hover:text-ink-dim"
      draggable
      title="Drag to a lane (e.g. Blocked)"
      aria-label="Drag to a lane"
      onClick={(e) => e.stopPropagation()}
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
      }}
    >
      <GripIcon />
    </span>
  );
}

export function GripIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <circle cx="5" cy="3.5" r="1.3" />
      <circle cx="11" cy="3.5" r="1.3" />
      <circle cx="5" cy="8" r="1.3" />
      <circle cx="11" cy="8" r="1.3" />
      <circle cx="5" cy="12.5" r="1.3" />
      <circle cx="11" cy="12.5" r="1.3" />
    </svg>
  );
}

function DetailsPanelIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <line x1="10" y1="3.4" x2="10" y2="12.6" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M1.5 8S3.8 3.5 8 3.5 14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8Z" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <path d="M6.3 4A6.6 6.6 0 0 1 8 3.5C12.2 3.5 14.5 8 14.5 8a11 11 0 0 1-1.9 2.4M3.5 5.6A11 11 0 0 0 1.5 8S3.8 12.5 8 12.5a6.5 6.5 0 0 0 2.4-.45" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.6 6.6a2 2 0 0 0 2.8 2.8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="2.5" y1="2.5" x2="13.5" y2="13.5" strokeLinecap="round" />
    </svg>
  );
}

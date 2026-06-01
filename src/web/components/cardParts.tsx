import type { AgentRecord } from '../../shared/types';
import { LivenessDot } from './LivenessDot';
import { PhaseStepper } from './PhaseStepper';
import { ToolMark } from './LogoIcons';
import { focusAgent } from '../sse';
import {
  clean,
  fallbackLine,
  needsReason,
  runtimeBadge,
  titleText,
  type LivenessLabel,
} from '../lib/format';

/**
 * Shared, presentational card pieces used by BOTH the All-tab `AgentCard` and the
 * per-project `SlotCard`. Pure functions of `agent` (+ small props) — no state, no
 * data fetching — so either composer can arrange them. Keeping them here means the
 * occupied-slot card and the flat card never drift apart.
 */

/* ── Shared card shell ─────────────────────────────────────────────────────
 * The two occupied-card composers (AgentCard, SlotCard) share the same shell:
 * same base classes, same tone/dim logic, same click-to-focus behaviour. These
 * helpers are the single source of truth so the cards never drift visually. */

/** Base shell classes (layout + surface + shadow + transition) common to every card. */
export const CARD_SHELL =
  'group relative flex flex-col gap-4 rounded-xl border bg-surface p-6 ' +
  'shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset,0_4px_16px_-8px_rgba(0,0,0,0.7)] ' +
  'outline-none transition-[border-color,background-color,opacity,box-shadow] duration-200';

/** Classes for an interactive (click-to-focus) occupied card. */
export const CARD_INTERACTIVE =
  'cursor-pointer hover:bg-surface-2 focus-visible:ring-1 focus-visible:ring-accent/60';

/** Border/glow treatment for an occupied card given its needs-you/error state. */
export function cardToneClass(
  wants: boolean,
  error: boolean,
  restingBorder = 'border-hairline',
): string {
  if (!wants) return `${restingBorder} hover:border-accent/50`;
  return error
    ? 'border-error/45 mc-accent-l-error mc-glow-error'
    : 'border-waiting/45 mc-accent-l-amber mc-glow-amber';
}

/** Opacity/saturation dimming for ended or idle (non-needs-you) cards. */
export function cardDimClasses(wants: boolean, live: LivenessLabel): string[] {
  const ended = !wants && live.tone === 'ended';
  const idleDim = !wants && live.tone === 'idle';
  return [ended ? 'opacity-60 saturate-[0.45]' : '', idleDim && !ended ? 'opacity-[0.88]' : ''];
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

/* ── Header (barely-there metadata) ────────────────────────────────────── */

export function CardHeader({
  agent,
  onSelect,
  showGrip = true,
  showLocation = true,
  onDragStart,
  onDragEnd,
}: {
  agent: AgentRecord;
  onSelect: (id: string) => void;
  /** Show the drag handle (All tab only). */
  showGrip?: boolean;
  /** Show the worktree·branch label (hidden in slots, where SlotMeta owns it). */
  showLocation?: boolean;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
}) {
  const rt = runtimeBadge(agent.runtime);
  const branch = clean(agent.branch);
  const worktree = clean(agent.worktree) ?? '—';

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-ink-faint">
      {showGrip && onDragStart && onDragEnd && (
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
      )}

      <ToolMark tool={agent.tool} />

      {rt && (
        <>
          <span className="text-ink-faint/60">·</span>
          <span className="uppercase tracking-wide">{rt}</span>
        </>
      )}

      {showLocation && (
        <>
          <span className="text-ink-faint/60">·</span>
          <span className="flex min-w-0 items-baseline gap-1 font-mono">
            <span className="truncate text-ink-dim" title={agent.cwd}>
              {worktree}
            </span>
            {branch && (
              <>
                <span className="text-ink-faint/60">·</span>
                <span className="truncate" title={branch}>
                  {branch}
                </span>
              </>
            )}
          </span>
        </>
      )}

      {agent.pinned && (
        <span className="shrink-0 text-ink-dim" title="Pinned" aria-label="Pinned">
          <PinIcon />
        </span>
      )}

      <span className="ml-auto flex shrink-0 items-center gap-2">
        <LivenessDot liveness={agent.liveness} basis={agent.livenessBasis} size={8} />
        <button
          type="button"
          title="Show details"
          aria-label="Show details"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(agent.id);
          }}
          className="-mr-1 rounded p-1 text-ink-faint opacity-80 transition hover:bg-surface-2 hover:text-ink hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
        >
          <DetailsPanelIcon />
        </button>
      </span>
    </div>
  );
}

/* ── Needs-you banner ──────────────────────────────────────────────────── */

export function NeedsYouBanner({ agent, error }: { agent: AgentRecord; error: boolean }) {
  const reason = needsReason(agent);
  return (
    <div
      className={[
        'flex items-start gap-2 rounded-lg border px-3 py-2',
        error
          ? 'border-error/40 bg-error/10 text-error'
          : 'border-waiting/40 bg-waiting/10 text-waiting',
      ].join(' ')}
    >
      <span className="mt-0.5 shrink-0">{error ? <AlertIcon /> : <HandIcon />}</span>
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider">
          {error ? 'Errored — needs you' : 'Needs you'}
        </div>
        <p className="mc-clamp-2 text-[12.5px] leading-snug">{reason}</p>
      </div>
    </div>
  );
}

/* ── Ready body: hero summary → minimal phase → single "Next" line ─────── */

export function ReadyBody({ agent }: { agent: AgentRecord }) {
  const nextStep = clean(agent.brief?.nextStep ?? null);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[18px] font-bold leading-tight tracking-tight text-ink">
        {titleText(agent)}
      </p>
      <PhaseStepper phase={agent.brief?.phase ?? null} variant="minimal" />
      {nextStep && (
        <p className="mc-clamp-2 text-[13px] leading-snug text-ink-dim">
          <span className="font-semibold uppercase tracking-wide text-ink-faint">Next: </span>
          {nextStep}
        </p>
      )}
    </div>
  );
}

/* ── Synthesizing (brief null/pending) ─────────────────────────────────── */

export function SynthesizingBody({ agent }: { agent: AgentRecord }) {
  const fallback = fallbackLine(agent);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[18px] font-bold leading-tight tracking-tight text-ink">
        {titleText(agent)}
      </p>
      {fallback && (
        <p className="mc-clamp-2 text-[12.5px] leading-snug text-ink-dim">{fallback}</p>
      )}
      <div className="flex items-center gap-1" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className="mc-shimmer h-[3px] flex-1" />
        ))}
      </div>
      <span className="text-[10.5px] tracking-wide text-ink-faint">Synthesizing…</span>
    </div>
  );
}

/* ── Footer: liveness label + a quiet "Open" action ────────────────────── */

export function CardFooter({ live }: { live: LivenessLabel }) {
  return (
    <div className="mt-auto flex items-center justify-between pt-1">
      <LivenessLabelPill live={live} />
      <span
        className="pointer-events-none flex items-center gap-1 text-[11.5px] font-semibold text-ink-dim transition-colors group-hover:text-accent"
        aria-hidden
      >
        Open agent
        <ArrowUpRightIcon />
      </span>
    </div>
  );
}

function LivenessLabelPill({ live }: { live: LivenessLabel }) {
  if (live.tone === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-live/40 bg-live/10 px-2 py-0.5 text-[10.5px] font-semibold text-live">
        <span className="mc-dot-live inline-block h-1.5 w-1.5 rounded-full bg-live" aria-hidden />
        {live.text}
      </span>
    );
  }
  const cls = live.tone === 'idle' ? 'text-idle' : 'text-ink-faint';
  return (
    <span className={`text-[10.5px] tabular-nums ${cls}`} title={live.text}>
      {live.text}
    </span>
  );
}

/* ── Icons ─────────────────────────────────────────────────────────────── */

function GripIcon() {
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

function ArrowUpRightIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M5 11 11 5M6 5h5v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DetailsPanelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <line x1="10" y1="3.4" x2="10" y2="12.6" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M9.5 1.5a.5.5 0 0 0-.86-.35L5.3 4.5H3a.5.5 0 0 0-.35.85L5.8 8.5l-3.3 4.6a.5.5 0 0 0 .7.7l4.6-3.3 3.15 3.15a.5.5 0 0 0 .85-.35V9l3.35-3.35a.5.5 0 0 0-.35-.86h-2.3l-2.99-3.29Z" />
    </svg>
  );
}

function HandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M7 1.75a1 1 0 0 1 2 0V7h.5V2.75a1 1 0 0 1 2 0V7.5h.5V4.25a1 1 0 0 1 2 0V10a4.5 4.5 0 0 1-4.5 4.5H8.9A4.4 4.4 0 0 1 5 12.2L2.4 8.6a1 1 0 0 1 1.5-1.3L5 8.5V2.75a1 1 0 0 1 2 0V7h0V1.75Z" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 1.2a1 1 0 0 1 .87.5l6.5 11.3a1 1 0 0 1-.87 1.5H1.5a1 1 0 0 1-.87-1.5L7.13 1.7A1 1 0 0 1 8 1.2Zm0 4.05a.85.85 0 0 0-.85.92l.3 3.2a.55.55 0 0 0 1.1 0l.3-3.2A.85.85 0 0 0 8 5.25Zm0 5.6a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z" />
    </svg>
  );
}

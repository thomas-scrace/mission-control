import type { Phase } from '../../shared/types';
import { PHASES, PHASE_LABELS } from '../../shared/types';
import { phaseIndex } from '../lib/format';

interface Props {
  /** The agent's current phase, or null when not yet known. */
  phase: Phase | null;
  /**
   * `full`    — drawer: a labeled 6-segment track (every step named).
   * `minimal` — card: a quiet 6-segment track filled up to current, with ONLY
   *             the current phase word shown beneath it. No per-step labels.
   */
  variant?: 'full' | 'minimal';
}

/** Space-tight labels used under each segment in the full (drawer) variant. */
const ABBREV: Record<Phase, string> = {
  planning: 'Plan',
  execution: 'Exec',
  testing: 'Test',
  simplification: 'Simpl',
  'code-review': 'Review',
  release: 'Ship',
};

/**
 * A 6-step workflow indicator.
 *
 * In `full` mode each step is labeled (used in the drawer). In `minimal` mode
 * the track is the quietest possible signal: completed/current segments take a
 * soft accent, upcoming ones are barely-there hairline, and only the current
 * phase word appears below — no competing labels.
 */
export function PhaseStepper({ phase, variant = 'full' }: Props) {
  const current = phaseIndex(phase);
  const known = current >= 0;
  const label = known ? PHASE_LABELS[phase as Phase] : null;

  if (variant === 'minimal') {
    return (
      <div
        role="group"
        aria-label={known ? `Workflow phase: ${label}` : 'Workflow phase unknown'}
        className="flex flex-col gap-1.5"
      >
        <div className="flex items-center gap-1" aria-hidden>
          {PHASES.map((p, i) => {
            const filled = known && i <= current;
            return (
              <span
                key={p}
                className={[
                  'h-[3px] flex-1 rounded-full',
                  filled ? 'bg-accent/55' : 'bg-hairline',
                ].join(' ')}
              />
            );
          })}
        </div>
        {label && (
          <span className="text-[10px] uppercase tracking-wider text-ink-faint">
            {label}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-1"
      role="group"
      aria-label={known ? `Workflow phase: ${label}` : 'Workflow phase unknown'}
    >
      {PHASES.map((p, i) => {
        const state = segmentState(known, i, current);
        return (
          <div
            key={p}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
            title={PHASE_LABELS[p]}
          >
            <span
              className={`h-1 w-full rounded-full transition-colors ${SEGMENT_BAR[state]}`}
              aria-hidden
            />
            <span
              className={`truncate text-[9px] leading-none tracking-wide ${SEGMENT_TEXT[state]}`}
            >
              {ABBREV[p]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type SegmentState = 'done' | 'current' | 'todo' | 'unknown';

/** Where a segment sits relative to the current phase (full-variant only). */
function segmentState(known: boolean, index: number, current: number): SegmentState {
  if (!known) return 'unknown';
  if (index < current) return 'done';
  if (index === current) return 'current';
  return 'todo';
}

const SEGMENT_BAR: Record<SegmentState, string> = {
  done: 'bg-accent/70',
  current: 'bg-accent',
  todo: 'bg-hairline-bright',
  unknown: 'bg-hairline',
};

const SEGMENT_TEXT: Record<SegmentState, string> = {
  done: 'text-ink-dim',
  current: 'font-semibold text-accent',
  todo: 'text-ink-faint',
  unknown: 'text-ink-faint',
};

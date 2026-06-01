import type { CiStatus, PullRequest } from '../../shared/types';

/* ── CI icons (inline SVGs, matched to the existing icon style) ─────────── */

/** Small green check — CI passing. */
function CiCheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3.5 8.5 6.5 11.5 12.5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Small red cross — CI failing. */
function CiCrossIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" strokeLinecap="round" />
    </svg>
  );
}

/** Small dot — CI pending (gets a gentle pulse, reduced-motion-aware). */
function CiPendingIcon() {
  return (
    <span
      className="mc-busy-pulse inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-current"
      aria-hidden
    />
  );
}

/**
 * A CI indicator: green check (passing), red cross (failing, optionally with a
 * tiny "f/total" count), amber dot (pending), nothing for none.
 */
export function CiIndicator({
  ci,
  checksTotal,
  checksFailing,
  withCount = false,
}: {
  ci: CiStatus;
  checksTotal: number;
  checksFailing: number;
  withCount?: boolean;
}) {
  if (ci === 'none') return null;

  if (ci === 'passing') {
    return (
      <span className="flex items-center text-done" title="CI passing" aria-label="CI passing">
        <CiCheckIcon />
      </span>
    );
  }

  if (ci === 'failing') {
    return (
      <span
        className="flex items-center gap-0.5 text-error"
        title={`CI failing — ${checksFailing}/${checksTotal} checks failing`}
        aria-label={`CI failing, ${checksFailing} of ${checksTotal} checks failing`}
      >
        <CiCrossIcon />
        {withCount && checksTotal > 0 && (
          <span className="text-[10px] tabular-nums">
            {checksFailing}/{checksTotal}
          </span>
        )}
      </span>
    );
  }

  // pending
  return (
    <span className="flex items-center text-waiting" title="CI pending" aria-label="CI pending">
      <CiPendingIcon />
    </span>
  );
}

/* ── Conditional warning tags (only render when their condition is true) ── */

type TagTone = 'error' | 'amber' | 'violet' | 'muted';

const TAG_TONE_CLASS: Record<TagTone, string> = {
  error: 'border-error/40 bg-error/10 text-error',
  amber: 'border-waiting/40 bg-waiting/10 text-waiting',
  violet: 'border-violet-400/30 bg-violet-400/10 text-violet-300',
  muted: 'border-hairline bg-surface-2 text-ink-faint',
};

export function Tag({ tone, children, title }: { tone: TagTone; children: React.ReactNode; title?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-px text-[10px] font-medium leading-none tracking-wide ${TAG_TONE_CLASS[tone]}`}
      title={title}
    >
      {children}
    </span>
  );
}

/** The set of conditional warning/state tags for a PR. Renders nothing when clean. */
export function PrTags({ pr }: { pr: PullRequest }) {
  const merged = pr.state === 'MERGED';
  const closed = pr.state === 'CLOSED';
  return (
    <>
      {pr.conflicts && <Tag tone="error">conflicts</Tag>}
      {pr.behindBase && <Tag tone="amber" title={`behind ${pr.baseRef}`}>behind</Tag>}
      {merged && <Tag tone="violet">merged</Tag>}
      {closed && <Tag tone="muted">closed</Tag>}
      {pr.isDraft && <Tag tone="muted">draft</Tag>}
    </>
  );
}

/* ── Card chip ──────────────────────────────────────────────────────────── */

/**
 * A compact, single-line PR chip for the card face. Calm at rest — a healthy
 * open PR reads as just "PR #145 ✓". Only pops via red/amber when something is
 * wrong. The link stops propagation so it opens the PR without opening the card.
 */
export function PrChip({ pr }: { pr: PullRequest }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11.5px]">
      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 font-medium tabular-nums text-ink-dim transition-colors hover:text-accent hover:underline"
        title={pr.title}
      >
        PR #{pr.number}
      </a>
      <CiIndicator
        ci={pr.ci}
        checksTotal={pr.checksTotal}
        checksFailing={pr.checksFailing}
        withCount
      />
      <span className="flex min-w-0 flex-wrap items-center gap-1">
        <PrTags pr={pr} />
      </span>
    </div>
  );
}

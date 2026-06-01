import type { Liveness } from '../../shared/types';

interface Props {
  liveness: Liveness;
  /** Shown as a native tooltip; pass the record's livenessBasis. */
  basis?: string | null;
  size?: number;
}

const LABEL: Record<Liveness, string> = {
  live: 'Live',
  idle: 'Idle',
  ended: 'Ended',
  unknown: 'Unknown',
};

/**
 * Liveness indicator:
 *  - live:    bright green, soft pulse
 *  - idle:    solid amber
 *  - ended:   hollow gray ring
 *  - unknown: hollow dim ring
 */
export function LivenessDot({ liveness, basis, size = 9 }: Props) {
  const title = basis ? `${LABEL[liveness]} — ${basis}` : LABEL[liveness];
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={`inline-block shrink-0 rounded-full ${dotVariant(liveness)}`}
      style={{ width: size, height: size }}
    />
  );
}

/** Variant-specific fill/ring classes per liveness bucket. */
function dotVariant(liveness: Liveness): string {
  switch (liveness) {
    case 'live':
      return 'mc-dot-live bg-live';
    case 'idle':
      return 'bg-waiting';
    case 'ended':
      // hollow ring, slightly brighter than unknown
      return 'border border-ink-faint bg-transparent';
    default:
      return 'border border-unknown bg-transparent';
  }
}

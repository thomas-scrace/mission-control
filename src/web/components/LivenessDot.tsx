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
  const dim = size;

  if (liveness === 'live') {
    return (
      <span
        role="img"
        aria-label={title}
        title={title}
        className="mc-dot-live inline-block shrink-0 rounded-full bg-live"
        style={{ width: dim, height: dim }}
      />
    );
  }

  if (liveness === 'idle') {
    return (
      <span
        role="img"
        aria-label={title}
        title={title}
        className="inline-block shrink-0 rounded-full bg-waiting"
        style={{ width: dim, height: dim }}
      />
    );
  }

  // ended / unknown -> hollow ring (ended slightly brighter than unknown)
  const ring = liveness === 'ended' ? 'border-ink-faint' : 'border-unknown';
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={`inline-block shrink-0 rounded-full border ${ring} bg-transparent`}
      style={{ width: dim, height: dim }}
    />
  );
}

import type { AgentStatus } from '../../shared/types';

interface Props {
  status: AgentStatus;
  /** Render slightly larger in the detail drawer. */
  size?: 'sm' | 'md';
}

interface PillStyle {
  label: string;
  className: string;
  pulse?: boolean;
}

const STYLES: Record<AgentStatus, PillStyle> = {
  waiting: {
    label: 'WAITING',
    className: 'text-waiting border-waiting/40 bg-waiting/10',
  },
  error: {
    label: 'ERROR',
    className: 'text-error border-error/40 bg-error/10',
  },
  busy: {
    label: 'BUSY',
    className: 'text-busy border-busy/40 bg-busy/10',
    pulse: true,
  },
  idle: {
    label: 'IDLE',
    className: 'text-idle border-idle/30 bg-idle/10',
  },
  done: {
    label: 'DONE',
    className: 'text-done border-done/30 bg-done/10',
  },
  unknown: {
    label: 'UNKNOWN',
    className: 'text-unknown border-unknown/30 bg-unknown/10',
  },
};

/** Compact status chip with status-specific color; busy gets a gentle pulse. */
export function StatusPill({ status, size = 'sm' }: Props) {
  const s = STYLES[status] ?? STYLES.unknown;
  const pad = size === 'md' ? 'px-2.5 py-1 text-[11px]' : 'px-2 py-0.5 text-[10px]';
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded border font-medium tracking-wider uppercase tabular-nums',
        pad,
        s.className,
        s.pulse ? 'mc-busy-pulse' : '',
      ].join(' ')}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full bg-current"
        aria-hidden
      />
      {s.label}
    </span>
  );
}

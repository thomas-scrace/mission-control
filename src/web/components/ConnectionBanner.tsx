import type { ConnectionState } from '../sse';
import { timeAgo } from '../lib/format';

/**
 * An unmissable bar shown when the live connection drops, so a FROZEN board can never be
 * mistaken for a live one (the root cause of "the whole dashboard is out of date" — the
 * collector had died and the page kept showing its last snapshot). Hidden while connected.
 */
export function ConnectionBanner({
  connection,
  lastEventAt,
  now,
}: {
  connection: ConnectionState;
  lastEventAt: number;
  now: number;
}) {
  if (connection !== 'reconnecting') return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="z-30 flex shrink-0 items-center justify-center gap-2.5 border-b border-error/40 bg-error/15 px-4 py-2 text-[12.5px] text-error"
    >
      <span className="mc-busy-pulse inline-block h-2 w-2 shrink-0 rounded-full bg-error" aria-hidden />
      <span className="font-medium">Disconnected from the collector.</span>
      <span className="text-error/85">
        Showing the last snapshot from {timeAgo(lastEventAt, now)} — is the Mission Control server still running? Reconnecting…
      </span>
    </div>
  );
}

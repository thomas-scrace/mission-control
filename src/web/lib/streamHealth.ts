/**
 * SSE stream-health constants + the staleness test, kept pure and dependency-free so
 * both the client hook and the UI (and the tests) can share them.
 *
 * The server emits a `ping` every {@link STREAM_HEARTBEAT_MS}. If the client hasn't heard
 * ANY event for {@link STREAM_STALE_MS} (a few missed heartbeats), the stream is treated as
 * dead — even if the socket never fired `error` (a half-open connection after the machine
 * sleeps) — and the client force-reconnects.
 */
import { STREAM_HEARTBEAT_MS } from '../../shared/stream';

export { STREAM_HEARTBEAT_MS };
export const STREAM_STALE_MS = 45_000; // no event for this long ⇒ assume the stream is dead (≈3 missed heartbeats)

/** Has the stream gone silent past the stale threshold? */
export function isStreamStale(lastEventAt: number, now: number, staleMs: number = STREAM_STALE_MS): boolean {
  return now - lastEventAt >= staleMs;
}

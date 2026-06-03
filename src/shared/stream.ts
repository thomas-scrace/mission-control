/**
 * SSE stream constants shared by the server (which emits the heartbeat) and the web client
 * (whose watchdog reconnects on silence). Deliberately DEPENDENCY-FREE — no `node:os`/`node:path`
 * — so the browser bundle can import it without dragging Node-only code in.
 */
export const STREAM_HEARTBEAT_MS = 15_000; // visible SSE ping cadence

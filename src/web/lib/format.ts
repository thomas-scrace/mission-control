import type { AgentRecord, Phase } from '../../shared/types';
import { PHASES } from '../../shared/types';

/**
 * Human "time ago" from an epoch-ms timestamp, computed against `now`
 * (defaults to Date.now()). Same machine as the server, so no clock skew.
 * Returns compact forms: "now", "8s", "4m", "2h", "3d".
 */
export function timeAgo(epochMs: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - epochMs);
  return formatDuration(diff);
}

/** Compact duration from a millisecond span: "now" | "8s" | "4m" | "2h" | "3d". */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 1) return 'now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/** Compact duration from a seconds count (used for idleSec). */
export function formatSeconds(sec: number): string {
  return formatDuration(sec * 1000);
}

/**
 * Token count -> "1.2k" / "126.4k" / "1.3M". Returns null for null input so
 * callers can hide the field entirely rather than render "null".
 */
export function formatTokens(tokens: number | null): string | null {
  if (tokens == null || !Number.isFinite(tokens) || tokens < 0) return null;
  if (tokens < 1000) return String(Math.round(tokens));
  if (tokens < 1_000_000) {
    const k = tokens / 1000;
    return `${trim(k)}k`;
  }
  const m = tokens / 1_000_000;
  return `${trim(m)}M`;
}

function trim(n: number): string {
  // One decimal place, but drop a trailing ".0".
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Context occupancy as a 0–100 percentage, or null when not computable. */
export function contextPct(
  tokens: number | null,
  contextWindow: number | null,
): number | null {
  if (tokens == null || contextWindow == null) return null;
  if (!Number.isFinite(tokens) || !Number.isFinite(contextWindow)) return null;
  if (contextWindow <= 0) return null;
  return Math.max(0, Math.min(100, (tokens / contextWindow) * 100));
}

/** Absolute clock time for tooltips / timeline, e.g. "14:32:09". */
export function clockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Full date-time for tooltips. */
export function fullDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString();
}

/**
 * Card order is STABLE and user-controlled: sort solely by `agent.order`
 * ascending. Cards never reshuffle on their own when status/liveness/updatedAt
 * change — they keep their place. Reordering only happens via drag (which
 * persists a new `order`). Ties (equal order) fall back to id for determinism.
 */
export function sortAgents(agents: readonly AgentRecord[]): AgentRecord[] {
  return [...agents].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * "Needs you" — the single most important signal. An agent needs you when the
 * synthesized brief says so, or (independent of the brief) when its status is
 * waiting or errored. The brief can flip a non-waiting agent into needs-you.
 */
export function needsYou(agent: AgentRecord): boolean {
  if (agent.brief?.needsYou) return true;
  return agent.status === 'waiting' || agent.status === 'error';
}

/** The human reason an agent needs you, with graceful fallbacks. */
export function needsReason(agent: AgentRecord): string {
  return (
    clean(agent.brief?.needsReason ?? null) ??
    clean(agent.statusDetail) ??
    'waiting for your input'
  );
}

/** Whether the needs-you / accent treatment should read as an error vs. a wait. */
export function isErrorTone(agent: AgentRecord): boolean {
  return agent.status === 'error';
}

export interface LivenessLabel {
  /** Short, glanceable label: "Live" | "idle 10m" | "ended 15h ago". */
  text: string;
  /** Which liveness bucket — drives colour/treatment on the card. */
  tone: 'live' | 'idle' | 'ended';
}

/**
 * A concise, human liveness label for the card. `idleSec` is the live-ticking
 * value computed from updatedAt, so "idle"/"ended" durations stay current.
 */
export function livenessLabel(
  agent: AgentRecord,
  idleSec: number | null,
): LivenessLabel {
  const ago = idleSec != null ? formatSeconds(idleSec) : null;
  // For a LIVE session, surface the fast-updating mechanical status (working vs. waiting vs. idle)
  // — this is the freshest signal and tells the user what the agent is doing *right now*.
  if (agent.liveness === 'live') {
    switch (agent.status) {
      case 'busy':
        return { text: 'Working', tone: 'live' };
      case 'waiting':
        return { text: 'Waiting on you', tone: 'idle' };
      case 'error':
        return { text: 'Error', tone: 'ended' };
      default:
        return { text: 'Idle (open)', tone: 'live' };
    }
  }
  if (agent.liveness === 'idle') return { text: ago ? `idle ${ago}` : 'idle', tone: 'idle' };
  if (agent.liveness === 'ended') return { text: ago ? `ended ${ago} ago` : 'ended', tone: 'ended' };
  return { text: ago ? `inactive ${ago}` : 'inactive', tone: 'ended' };
}

/**
 * The card hero: a SHORT 1-4 word name. Prefer the synthesized title, then the
 * user's rename, then the derived job, so the card is never blank.
 */
export function titleText(agent: AgentRecord): string {
  return clean(agent.brief?.title ?? null) ?? displayJob(agent);
}

/**
 * The fuller one-line description (shown in the drawer / used for search).
 * Falls back to the title/job so it's never blank.
 */
export function summaryText(agent: AgentRecord): string {
  return clean(agent.brief?.summary ?? null) ?? titleText(agent);
}

/** True once the brief has arrived and synthesis succeeded. */
export function briefReady(agent: AgentRecord): boolean {
  return agent.brief != null && agent.brief.state === 'ready';
}

/** True while the brief is still being synthesized (null or pending). */
export function briefPending(agent: AgentRecord): boolean {
  return agent.brief == null || agent.brief.state === 'pending';
}

/** A quiet fallback line for cards whose brief hasn't arrived yet. */
export function fallbackLine(agent: AgentRecord): string | null {
  return clean(agent.lastAction) ?? clean(agent.job);
}

/**
 * Position of a phase in the workflow (0-based), or -1 if unknown.
 * Used by the stepper to mark steps complete / current / upcoming.
 */
export function phaseIndex(phase: Phase | null | undefined): number {
  if (phase == null) return -1;
  return PHASES.indexOf(phase);
}

/** The headline to display: user override (jobName) wins over the derived job. */
export function displayJob(agent: AgentRecord): string {
  const name = agent.jobName?.trim();
  if (name) return name;
  const job = agent.job?.trim();
  if (job) return job;
  return 'Untitled session';
}

/** Short tool badge label. */
export function toolBadge(tool: AgentRecord['tool']): string {
  return tool === 'claude' ? 'CC' : 'CDX';
}

/** Short runtime label, or null when unknown (so the UI can hide it). */
export function runtimeBadge(runtime: AgentRecord['runtime']): string | null {
  switch (runtime) {
    case 'terminal':
      return 'term';
    case 'app':
      return 'app';
    case 'ide':
      return 'ide';
    default:
      return null;
  }
}

/** The last path segment, e.g. "/Users/me/repo-wt/feat-x" → "feat-x". */
export function baseName(p: string): string {
  if (!p) return '';
  const trimmed = p.replace(/\/+$/, '');
  const i = trimmed.lastIndexOf('/');
  return i === -1 ? trimmed : trimmed.slice(i + 1) || trimmed;
}

/** A compact, home-relative path for tooltips: "/Users/me/x" → "~/x". */
export function shortPath(p: string): string {
  if (!p) return '';
  return p.replace(/^\/Users\/[^/]+\//, '~/').replace(/^\/home\/[^/]+\//, '~/');
}

/** Collapse falsy / whitespace-only strings to null so we never render blanks. */
export function clean(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t.length ? t : null;
}

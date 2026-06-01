import { run } from '../collector/sh';
import type { AgentRecord, AgentStatus } from '../shared/types';

const NEEDS_YOU: AgentStatus[] = ['waiting', 'error'];
const COOLDOWN_MS = 60_000;

const lastNotified = new Map<string, number>();
const prevStatus = new Map<string, AgentStatus>();

function clean(s: string): string {
  return s.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}

/** Record current status without notifying — used at startup so we don't alert for pre-existing states. */
export function primeStatus(agent: AgentRecord): void {
  prevStatus.set(agent.id, agent.status);
}

/** Fire a native macOS notification when an agent newly needs you (transition into waiting/error). */
export function considerNotify(agent: AgentRecord): void {
  const prev = prevStatus.get(agent.id);
  prevStatus.set(agent.id, agent.status);
  if (agent.dismissed) return;
  if (!NEEDS_YOU.includes(agent.status)) return;
  if (prev === agent.status) return; // only on transition INTO the state

  const now = Date.now();
  if (now - (lastNotified.get(agent.id) ?? 0) < COOLDOWN_MS) return;
  lastNotified.set(agent.id, now);

  const name = agent.jobName || agent.job;
  const title = agent.status === 'waiting' ? `⏳ ${name}` : `⛔ ${name}`;
  const subtitle = `${agent.tool} · ${agent.worktree}${agent.branch ? ` · ${agent.branch}` : ''}`;
  const body = agent.statusDetail || (agent.status === 'waiting' ? 'waiting for your input' : 'error');
  const script = `display notification "${clean(body)}" with title "${clean(title)}" subtitle "${clean(subtitle)}" sound name "Glass"`;
  void run(`osascript -e '${script.replace(/'/g, "’")}'`).catch(() => {});
}

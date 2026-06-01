import { EventEmitter } from 'node:events';
import type { AgentRecord } from '../shared/types';

export type StoreChange = { type: 'upsert'; agent: AgentRecord } | { type: 'remove'; id: string };

/** In-memory map of the current fleet. Emits 'change' so the server can push diffs over SSE. */
class AgentStore extends EventEmitter {
  private map = new Map<string, AgentRecord>();

  upsert(agent: AgentRecord): void {
    const prev = this.map.get(agent.id);
    this.map.set(agent.id, agent);
    // Only emit when something the UI cares about actually changed (avoids SSE spam from sweeps).
    if (!prev || !shallowEqualForUi(prev, agent)) {
      this.emit('change', { type: 'upsert', agent } satisfies StoreChange);
    }
  }

  remove(id: string): void {
    if (this.map.delete(id)) this.emit('change', { type: 'remove', id } satisfies StoreChange);
  }

  get(id: string): AgentRecord | undefined {
    return this.map.get(id);
  }

  all(): AgentRecord[] {
    return [...this.map.values()];
  }
}

// Fields whose change is worth a push. (updatedAt/idleSec tick constantly; ignore them here —
// the client re-derives the idle timer locally, so a pure time tick needn't cross the wire.)
// NOTE: livenessBasis is deliberately EXCLUDED — its "active 8s ago" text ticks every sweep and
// would push an update (and a card flash) every 2.5s. The liveness enum still pushes.
const UI_FIELDS: (keyof AgentRecord)[] = [
  'status', 'statusDetail', 'liveness', 'job', 'jobName', 'branch', 'worktree',
  'lastAction', 'lastMessage', 'tokens', 'model', 'subagentsActive', 'pinned', 'dismissed', 'notes', 'prLink', 'runtime', 'order',
];

function shallowEqualForUi(a: AgentRecord, b: AgentRecord): boolean {
  for (const k of UI_FIELDS) if (a[k] !== b[k]) return false;
  if (a.history.length !== b.history.length) return false;
  // the synthesized brief is the heart of the card — push when any of it changes
  if (!briefEqual(a.brief, b.brief)) return false;
  return prEqual(a.pr, b.pr);
}

function briefEqual(x: AgentRecord['brief'], y: AgentRecord['brief']): boolean {
  if (!x || !y) return x === y;
  return x.state === y.state && x.at === y.at && x.title === y.title && x.summary === y.summary && x.phase === y.phase && x.needsYou === y.needsYou && x.nextStep === y.nextStep && x.lastAsk === y.lastAsk;
}

function prEqual(x: AgentRecord['pr'], y: AgentRecord['pr']): boolean {
  if (!x || !y) return x === y;
  return x.number === y.number && x.state === y.state && x.ci === y.ci && x.conflicts === y.conflicts && x.behindBase === y.behindBase && x.isDraft === y.isDraft;
}

export const store = new AgentStore();

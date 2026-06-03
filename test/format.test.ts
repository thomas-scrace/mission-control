import { describe, it, expect } from 'vitest';
import type { AgentRecord } from '../src/shared/types';
import { agentLane, selectHidden } from '../src/web/lib/format';

const agent = (over: Partial<AgentRecord>): AgentRecord => ({ id: 'x', order: 0, dismissed: false, ...over } as AgentRecord);

// Running = process alive + actively working; Needs-me = process alive but yielded
// (returned / asking / idle at the prompt); Inactive = no process (worktree free).
describe('agentLane', () => {
  it('busy + alive -> running', () => {
    expect(agentLane({ status: 'busy', liveness: 'live' })).toBe('running');
    expect(agentLane({ status: 'busy', liveness: 'idle' })).toBe('running');
  });

  it('alive but not working -> needs-me', () => {
    expect(agentLane({ status: 'waiting', liveness: 'live' })).toBe('needs-me');
    expect(agentLane({ status: 'idle', liveness: 'idle' })).toBe('needs-me');
    expect(agentLane({ status: 'error', liveness: 'live' })).toBe('needs-me');
    expect(agentLane({ status: 'done', liveness: 'idle' })).toBe('needs-me');
  });

  it('no live process -> inactive (regardless of last status)', () => {
    expect(agentLane({ status: 'idle', liveness: 'ended' })).toBe('inactive');
    expect(agentLane({ status: 'busy', liveness: 'ended' })).toBe('inactive');
    expect(agentLane({ status: 'unknown', liveness: 'unknown' })).toBe('inactive');
  });

  it('busy + quiet but the brief flags needsYou -> needs-me (e.g. a plan-mode question)', () => {
    expect(agentLane({ status: 'busy', liveness: 'idle', brief: { needsYou: true } as any })).toBe('needs-me');
  });

  it('busy with a non-needs-you brief stays running', () => {
    expect(agentLane({ status: 'busy', liveness: 'live', brief: { needsYou: false } as any })).toBe('running');
  });

  it('actively producing (busy + live) beats a STALE needs-you brief -> running', () => {
    expect(agentLane({ status: 'busy', liveness: 'live', brief: { needsYou: true } as any })).toBe('running');
  });

  it('a running background subagent keeps it Running even if the main thread is idle', () => {
    expect(agentLane({ status: 'idle', liveness: 'idle', subagentsActive: 1 })).toBe('running');
  });
});

// The Hidden tab shows exactly the agents the user has hidden (dismissed === true),
// in the same stable order as the board. Everything else stays out of it.
describe('selectHidden', () => {
  it('keeps only dismissed agents', () => {
    const out = selectHidden([
      agent({ id: 'a', dismissed: false }),
      agent({ id: 'b', dismissed: true }),
      agent({ id: 'c', dismissed: true }),
    ]);
    expect(out.map((a) => a.id)).toEqual(['b', 'c']);
  });

  it('orders hidden agents by board order (then id)', () => {
    const out = selectHidden([
      agent({ id: 'b', dismissed: true, order: 5 }),
      agent({ id: 'a', dismissed: true, order: -2 }),
    ]);
    expect(out.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('returns an empty array when nothing is hidden', () => {
    expect(selectHidden([agent({ id: 'a' }), agent({ id: 'b' })])).toEqual([]);
  });
});

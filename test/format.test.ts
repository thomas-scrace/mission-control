import { describe, it, expect } from 'vitest';
import { agentLane } from '../src/web/lib/format';

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

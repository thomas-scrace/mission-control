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
});

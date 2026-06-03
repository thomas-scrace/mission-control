import { describe, it, expect } from 'vitest';
import { classifyClaudeLiveness, type ClaudeProc } from '../src/collector/liveness';
import type { AgentRecord } from '../src/shared/types';

const agent = (over: Partial<AgentRecord>): AgentRecord =>
  ({ cwd: '/Users/me/repo', worktree: 'repo', status: 'idle', updatedAt: Date.now() - 10 * 60_000, ...over } as AgentRecord);

const proc = (cwd: string): ClaudeProc => ({ pid: 1, tty: 'ttys001', cwd });

describe('classifyClaudeLiveness — waiting agents stay live', () => {
  it('a WAITING agent with a claude process in its worktree is live (not idle), even when stale', () => {
    const r = classifyClaudeLiveness(agent({ status: 'waiting' }), [proc('/Users/me/repo')], '/Users/me/repo');
    expect(r.liveness).toBe('live');
  });

  it('a waiting agent with NO matching process does not get faked live', () => {
    const r = classifyClaudeLiveness(agent({ status: 'waiting' }), [], '/Users/me/repo');
    expect(r.liveness).not.toBe('live');
  });

  it('a stale non-waiting agent is not live just because a claude runs in its worktree', () => {
    const r = classifyClaudeLiveness(agent({ status: 'idle' }), [proc('/Users/me/repo')], '/Users/me/repo');
    expect(r.liveness).not.toBe('live');
  });
});

describe('classifyClaudeLiveness — occupied vs available', () => {
  const quiet = Date.now() - 30 * 60_000; // 30 min: past the "ended by recency" threshold

  it('a quiet worktree WITH a running claude is idle (occupied), not ended', () => {
    const r = classifyClaudeLiveness(agent({ status: 'idle', updatedAt: quiet }), [proc('/Users/me/repo')], '/Users/me/repo');
    expect(r.liveness).toBe('idle');
  });

  it('a quiet worktree with NO process is ended (so its slot reads as available)', () => {
    const r = classifyClaudeLiveness(agent({ status: 'idle', updatedAt: quiet }), [], '/Users/me/repo');
    expect(r.liveness).toBe('ended');
  });
});

// A worktree's live `claude` process backs its MOST-RECENT session. Older sessions that
// merely share the directory must NOT inherit that process and masquerade as live/needs-you.
// The collector passes isLead=false for any session that isn't the worktree's newest.
describe('classifyClaudeLiveness — only the worktree lead claims the process', () => {
  const stale = Date.now() - 56 * 60 * 60_000; // 56h ago (the real-world bug)

  it('a stale WAITING non-lead session does NOT show live (it inherited a sibling\'s process)', () => {
    const lead = classifyClaudeLiveness(agent({ status: 'waiting', updatedAt: stale }), [proc('/Users/me/repo')], '/Users/me/repo', undefined, true);
    expect(lead.liveness).toBe('live'); // the lead still does

    const nonLead = classifyClaudeLiveness(agent({ status: 'waiting', updatedAt: stale }), [proc('/Users/me/repo')], '/Users/me/repo', undefined, false);
    expect(nonLead.liveness).toBe('ended');
  });

  it('a quiet non-lead session reads as ended (its worktree-mate owns the process)', () => {
    const quiet = Date.now() - 30 * 60_000;
    const nonLead = classifyClaudeLiveness(agent({ status: 'idle', updatedAt: quiet }), [proc('/Users/me/repo')], '/Users/me/repo', undefined, false);
    expect(nonLead.liveness).toBe('ended');
  });

  it('omitting isLead preserves the old behavior (defaults to lead)', () => {
    const r = classifyClaudeLiveness(agent({ status: 'waiting' }), [proc('/Users/me/repo')], '/Users/me/repo');
    expect(r.liveness).toBe('live');
  });
});

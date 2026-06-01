import { describe, it, expect } from 'vitest';
import { parseWorktreeList } from '../src/collector/git';

describe('parseWorktreeList', () => {
  const porcelain = [
    'worktree /Users/dev/repo',
    'HEAD abc123',
    'branch refs/heads/main',
    '',
    'worktree /Users/dev/repo-wt/feat-x',
    'HEAD def456',
    'branch refs/heads/feat/x',
    '',
    'worktree /Users/dev/repo-wt/detached',
    'HEAD 999000',
    'detached',
    '',
  ].join('\n');

  it('returns the primary checkout first, with its branch', () => {
    const wts = parseWorktreeList(porcelain);
    expect(wts).toHaveLength(3);
    expect(wts[0]!.path).toBe('/Users/dev/repo');
    expect(wts[0]!.branch).toBe('main');
    expect(wts[0]!.detached).toBe(false);
  });

  it('strips refs/heads/ from linked-worktree branch names', () => {
    expect(parseWorktreeList(porcelain)[1]!.branch).toBe('feat/x');
  });

  it('marks a detached worktree (null branch, detached true)', () => {
    const wts = parseWorktreeList(porcelain);
    expect(wts[2]!.branch).toBeNull();
    expect(wts[2]!.detached).toBe(true);
  });

  it('marks a bare primary checkout', () => {
    const wts = parseWorktreeList('worktree /Users/dev/bare.git\nbare\n');
    expect(wts[0]!.bare).toBe(true);
    expect(wts[0]!.branch).toBeNull();
  });

  it('returns [] for empty input', () => {
    expect(parseWorktreeList('')).toEqual([]);
  });
});

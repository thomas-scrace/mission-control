import { describe, it, expect } from 'vitest';
import { pickWinner, toSlotAgentRef, slotOccupant, projectStore, refreshProjects } from '../src/collector/projects';
import type { AgentRecord, Liveness, AgentStatus, Project } from '../src/shared/types';

// pickWinner only reads id/liveness/updatedAt/status; cast a minimal shape.
function ag(id: string, liveness: Liveness, updatedAt: number, status: AgentStatus = 'idle'): AgentRecord {
  return { id, liveness, updatedAt, status } as unknown as AgentRecord;
}

describe('pickWinner', () => {
  it('returns null for an empty worktree (no candidates)', () => {
    expect(pickWinner([])).toBeNull();
  });

  it('a LIVE agent occupies the slot even if a dead session touched it more recently', () => {
    const live = ag('live', 'live', 1000);
    const recentDead = ag('dead', 'ended', 9999); // newer, but not live
    expect(pickWinner([recentDead, live])!.id).toBe('live');
  });

  it('among non-live candidates, the most-recently-updated wins', () => {
    const older = ag('older', 'idle', 1000);
    const newer = ag('newer', 'ended', 5000);
    expect(pickWinner([older, newer])!.id).toBe('newer');
  });
});

describe('refreshProjects resilience', () => {
  it('does NOT wipe existing projects when a build comes back empty (transient git failure)', async () => {
    const existing: Project = { id: 'repo-x', name: 'x', root: '/x', slots: [], origin: 'discovered', at: 0 };
    projectStore.upsert(existing);
    // No agents in the store + no manual projects → buildProjects() returns [] this tick.
    // The guard must treat that as a transient failure and keep the existing project.
    await refreshProjects(0);
    expect(projectStore.get('repo-x')).toBeTruthy();
  });
});

describe('slotOccupant', () => {
  it('an ENDED winner does not occupy the slot (so it reads as available)', () => {
    expect(slotOccupant(ag('x', 'ended', 1000))).toBeNull();
  });
  it('a live or idle winner occupies the slot', () => {
    expect(slotOccupant(ag('a', 'live', 1000))?.id).toBe('a');
    expect(slotOccupant(ag('b', 'idle', 1000))?.id).toBe('b');
  });
  it('no winner -> no occupant', () => {
    expect(slotOccupant(null)).toBeNull();
  });
});

describe('toSlotAgentRef', () => {
  it('marks needsYou from a waiting status when no brief says otherwise', () => {
    const a = { id: 'x', tool: 'claude', status: 'waiting', liveness: 'live', job: 'J', jobName: null, brief: null } as unknown as AgentRecord;
    const ref = toSlotAgentRef(a);
    expect(ref.needsYou).toBe(true);
    expect(ref.id).toBe('x');
    expect(ref.tool).toBe('claude');
  });

  it('honours an explicit brief.needsYou=false even when busy', () => {
    const a = { id: 'y', tool: 'codex', status: 'busy', liveness: 'live', job: 'J', jobName: null, brief: { needsYou: false } } as unknown as AgentRecord;
    expect(toSlotAgentRef(a).needsYou).toBe(false);
  });
});

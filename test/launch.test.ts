import { describe, it, expect, beforeAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { isAllowedWorktree } from '../src/collector/launch';
import { projectStore } from '../src/collector/projects';
import type { Project } from '../src/shared/types';

// The launch endpoint runs a shell from a local server, so it MUST only accept
// paths it actually enumerated from git AND that live under HOME.
const HOME = os.homedir();
const REPO = path.resolve(__dirname, '..'); // /Users/<me>/missioncontrol — exists, under HOME

beforeAll(() => {
  const project: Project = {
    id: 'test-project',
    name: 'missioncontrol',
    root: REPO,
    origin: 'discovered',
    at: Date.now(),
    slots: [
      { path: REPO, branch: 'master', isPrimary: true, exists: true, detached: false, bare: false, dirty: null, ahead: null, behind: null, pr: null, agent: null, sessionsCount: 0 },
    ],
  };
  projectStore.upsert(project);
});

describe('isAllowedWorktree (launch allowlist)', () => {
  it('accepts a path that is an enumerated worktree slot under HOME', async () => {
    expect(await isAllowedWorktree(REPO)).not.toBeNull();
  });

  it('rejects a path under HOME that is NOT an enumerated slot (e.g. HOME itself)', async () => {
    expect(await isAllowedWorktree(HOME)).toBeNull();
  });

  it('rejects a path outside HOME entirely', async () => {
    expect(await isAllowedWorktree('/tmp')).toBeNull();
    expect(await isAllowedWorktree('/etc')).toBeNull();
  });

  it('rejects a non-existent path', async () => {
    expect(await isAllowedWorktree(path.join(REPO, 'does-not-exist-xyz'))).toBeNull();
  });
});

// Shared helpers for the Mission Control service scripts (doctor / install / uninstall / service).
// Pure Node, no dependencies — these run before/around the app itself.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOME = os.homedir();
export const UID = process.getuid();

// Label and port are overridable via env so users can run a custom port and tests can use a
// throwaway label without touching the real service.
export const LABEL = process.env.MC_SERVICE_LABEL || 'com.missioncontrol.server';
export const PORT = process.env.MC_PORT || '4317';

export const LAUNCH_AGENTS = path.join(HOME, 'Library', 'LaunchAgents');
export const PLIST = path.join(LAUNCH_AGENTS, `${LABEL}.plist`);
export const STATE_DIR = path.join(HOME, '.missioncontrol');
export const LOG_DIR = path.join(STATE_DIR, 'logs');
export const LOG = path.join(LOG_DIR, 'server.log');
export const URL = `http://127.0.0.1:${PORT}`;

export const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/** Absolute path of an executable on PATH, or null. */
export function which(cmd) {
  try {
    return execFileSync('/usr/bin/which', [cmd], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

/** Run a command, returning { ok, out }. Never throws. */
export function run(cmd, args, opts = {}) {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    return { ok: true, out: (out || '').trim() };
  } catch (e) {
    return { ok: false, out: ((e.stdout || '') + (e.stderr || '')).toString().trim(), code: e.status };
  }
}

/** launchctl domain target for the current GUI user. */
export const GUI = `gui/${UID}`;

/** Is the dashboard answering on its port right now? Polls up to `tries` times. */
export async function waitForServer(tries = 20, delayMs = 750) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${URL}/api/snapshot`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((res) => setTimeout(res, delayMs));
  }
  return false;
}

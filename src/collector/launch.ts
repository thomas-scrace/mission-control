import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { HOME } from '../shared/config';
import type { Tool } from '../shared/types';
import { projectStore } from './projects';

const execFileAsync = promisify(execFile);

export interface LaunchResult {
  ok: boolean;
  detail: string;
}

async function osa(script: string): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 8000 });
  return stdout.trim();
}

/**
 * The launch endpoint executes a shell from a local web server, so a path is only
 * acceptable if it is BOTH (a) under HOME and (b) a worktree slot we actually
 * enumerated from git. realpath both sides to defeat `..`/symlink escapes.
 * Returns the canonical path when allowed, else null.
 */
export async function isAllowedWorktree(p: string): Promise<string | null> {
  let real: string;
  try {
    real = await realpath(p);
  } catch {
    return null;
  }
  const home = HOME.endsWith('/') ? HOME : HOME + '/';
  if (!(real === HOME || real.startsWith(home))) return null;
  for (const project of projectStore.all()) {
    for (const slot of project.slots) {
      try {
        if ((await realpath(slot.path)) === real) return real;
      } catch {
        // slot dir gone — skip
      }
    }
  }
  return null;
}

/** POSIX single-quote a string for safe use inside a shell command. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function launchClaude(worktree: string, skipPermissions: boolean): Promise<LaunchResult> {
  // Two layers of escaping: a single-quoted shell path, embedded in a double-quoted
  // AppleScript string (escape backslashes first, then double-quotes).
  const flags = skipPermissions ? ' --dangerously-skip-permissions' : '';
  const cmd = `cd ${shQuote(worktree)} && claude${flags}`;
  const inner = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `tell application "iTerm2"
  activate
  if (count of windows) = 0 then
    create window with default profile
    tell current session of current window to write text "${inner}"
  else
    tell current window
      create tab with default profile
      tell current session of current tab to write text "${inner}"
    end tell
  end if
end tell
return "ok"`;
  try {
    await osa(script);
    return { ok: true, detail: `Launched Claude in ${path.basename(worktree)}` };
  } catch (e: any) {
    return { ok: false, detail: `Could not launch Claude: ${String(e?.message ?? e)}` };
  }
}

async function launchCodex(worktree: string): Promise<LaunchResult> {
  // The Codex app has no launch-with-cwd API — raise it and put the worktree path on
  // the clipboard (via pbcopy stdin, so no shell, no escaping) for the user to paste.
  try {
    await execFileAsync('open', ['-a', 'Codex'], { timeout: 8000 });
  } catch {
    /* app may still come up; the clipboard is the useful part */
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('pbcopy');
      child.on('error', reject);
      child.on('close', () => resolve());
      child.stdin.end(worktree);
    });
  } catch {
    return { ok: true, detail: `Opened Codex — couldn't copy path; cd into ${path.basename(worktree)} yourself` };
  }
  return { ok: true, detail: 'Opened Codex — worktree path copied to clipboard' };
}

export async function launchAgent(
  worktreePath: string,
  tool: Tool,
  opts: { skipPermissions?: boolean } = {},
): Promise<LaunchResult> {
  if (tool !== 'claude' && tool !== 'codex') return { ok: false, detail: 'Unknown tool' };
  const real = await isAllowedWorktree(worktreePath);
  if (!real) return { ok: false, detail: 'Path is not a known worktree under your home directory' };
  return tool === 'claude' ? launchClaude(real, !!opts.skipPermissions) : launchCodex(real);
}

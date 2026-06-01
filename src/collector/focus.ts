import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentRecord } from '../shared/types';
import { getClaudeProcesses, findClaudeProc } from './liveness';

const execFileAsync = promisify(execFile);

export interface FocusResult {
  ok: boolean;
  detail: string;
}

async function osa(script: string): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 8000 });
  return stdout.trim();
}

/** Select the exact iTerm2 tab whose tty matches, and bring iTerm to the front. */
async function focusItermByTty(tty: string): Promise<boolean> {
  const dev = tty.startsWith('/dev/') ? tty : `/dev/${tty}`;
  const script = `tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s is "${dev}" then
          select s
          tell t to select
          select w
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end repeat
end tell
return "nf"`;
  try {
    return (await osa(script)) === 'ok';
  } catch {
    return false;
  }
}

/**
 * Bring the agent's own window to the front:
 *  - Codex  → deep-link the specific thread (codex://threads/<id>), which also raises the app.
 *  - Claude → focus the exact iTerm tab via the backing process's tty; fall back to the Claude
 *             desktop app, then to just raising iTerm.
 */
export async function focusAgent(agent: AgentRecord): Promise<FocusResult> {
  if (agent.tool === 'codex') {
    try {
      await execFileAsync('open', [`codex://threads/${agent.id}`], { timeout: 8000 });
      return { ok: true, detail: 'Opened Codex thread' };
    } catch {
      try {
        await execFileAsync('open', ['-a', 'Codex'], { timeout: 8000 });
        return { ok: true, detail: 'Activated Codex' };
      } catch {
        return { ok: false, detail: 'Could not open Codex' };
      }
    }
  }

  // Claude: focus the exact iTerm tab via the backing process's tty.
  const proc = findClaudeProc(agent.cwd, await getClaudeProcesses());
  if (proc?.tty && (await focusItermByTty(proc.tty))) {
    return { ok: true, detail: `Focused iTerm tab (${proc.tty})` };
  }

  if (agent.runtime === 'app') {
    try {
      await execFileAsync('open', ['-a', 'Claude'], { timeout: 8000 });
      return { ok: true, detail: 'Activated Claude app' };
    } catch {
      /* fall through */
    }
  }

  try {
    await osa('tell application "iTerm2" to activate');
    return { ok: true, detail: 'Raised iTerm (exact tab not found)' };
  } catch {
    return { ok: false, detail: 'Could not locate the agent window' };
  }
}

import { useState } from 'react';
import type { Tool } from '../../shared/types';
import { launchAgent } from '../sse';
import { ToolMark } from './LogoIcons';

type State = 'idle' | 'launching' | 'done' | 'error';

// Persisted, shared default: launch Claude with --dangerously-skip-permissions (the usual workflow).
const SKIP_PERMS_KEY = 'mc.skipPermissions';
function readSkipPerms(): boolean {
  try {
    return localStorage.getItem(SKIP_PERMS_KEY) !== '0'; // default ON
  } catch {
    return true;
  }
}
function writeSkipPerms(v: boolean): void {
  try {
    localStorage.setItem(SKIP_PERMS_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/**
 * The Start control for an EMPTY slot. Claude is a real launch (a new iTerm tab
 * cd'd into the worktree). Codex raises the app and copies the path (the app has
 * no launch-with-cwd API). On a successful Claude launch the slot flips to occupied
 * via SSE and this control unmounts.
 */
export function StartAgentControl({ worktreePath }: { worktreePath: string }) {
  const [state, setState] = useState<State>('idle');
  const [pendingTool, setPendingTool] = useState<Tool | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [skipPerms, setSkipPerms] = useState<boolean>(readSkipPerms);

  async function start(tool: Tool) {
    setState('launching');
    setPendingTool(tool);
    setDetail(null);
    try {
      const r = await launchAgent(worktreePath, tool, { skipPermissions: skipPerms });
      setState(r.ok ? 'done' : 'error');
      setDetail(r.detail);
    } catch {
      setState('error');
      setDetail('Launch failed');
    } finally {
      setPendingTool(null);
    }
  }

  const busy = state === 'launching';

  return (
    <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <StartButton tool="claude" label="Claude" primary busy={busy && pendingTool === 'claude'} disabled={busy} onClick={() => void start('claude')} />
        <StartButton tool="codex" label="Codex" busy={busy && pendingTool === 'codex'} disabled={busy} onClick={() => void start('codex')} />
      </div>
      <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-ink-faint" title="Launch Claude with --dangerously-skip-permissions">
        <input
          type="checkbox"
          checked={skipPerms}
          onChange={(e) => {
            setSkipPerms(e.target.checked);
            writeSkipPerms(e.target.checked);
          }}
          className="h-3.5 w-3.5 accent-accent"
        />
        Claude: skip permissions
      </label>
      <span className="text-[10px] text-ink-faint">Codex opens the app &amp; copies the path</span>
      {detail && <span className={`text-[11px] ${state === 'error' ? 'text-error' : 'text-ink-faint'}`}>{detail}</span>}
    </div>
  );
}

function StartButton({
  tool,
  label,
  primary = false,
  busy,
  disabled,
  onClick,
}: {
  tool: Tool;
  label: string;
  primary?: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-60',
        primary
          ? 'border-accent/50 bg-accent/10 text-accent hover:bg-accent/15'
          : 'border-hairline-bright bg-surface-2/60 text-ink-dim hover:text-ink',
      ].join(' ')}
    >
      {busy ? (
        <span className="mc-spin inline-block h-3.5 w-3.5 rounded-full border-2 border-hairline border-t-current" aria-hidden />
      ) : (
        <ToolMark tool={tool} size={13} />
      )}
      Start {label}
    </button>
  );
}

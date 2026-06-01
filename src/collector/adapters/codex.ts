import path from 'node:path';
import { parseTsToEpochMs, toEpochMs } from '../time';
import { HISTORY_LIMIT } from '../../shared/config';
import type { AgentRecord, AgentStatus, HistoryEntry, Runtime } from '../../shared/types';

/** One row of ~/.codex/state_5.sqlite `threads` — the authoritative Codex index. */
export interface CodexThread {
  id: string;
  cwd: string;
  git_branch: string | null;
  title: string;
  archived: number;
  updated_at_ms: number | null;
  updated_at?: number | null; // epoch seconds (fallback)
  model: string | null;
  tokens_used: number | null;
  first_user_message?: string | null;
  preview?: string | null;
  rollout_path: string;
  source?: string | null;
}

function snippet(s: unknown, n = 120): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
}

function runtimeFromOriginator(originator: string | null | undefined, source?: string | null): Runtime {
  const o = (originator ?? '').toLowerCase();
  if (o.includes('desktop') || o.includes('app')) return 'app';
  if (o.includes('cli') || o === 'codex_cli_rs') return 'terminal';
  if (o.includes('vscode') || source === 'vscode') return 'ide';
  return 'unknown';
}

function execCmd(payload: any): string | null {
  if (payload?.name !== 'exec_command') return null;
  try {
    const args = typeof payload.arguments === 'string' ? JSON.parse(payload.arguments) : payload.arguments;
    return args?.cmd ? snippet(args.cmd, 90) : null;
  } catch {
    return null;
  }
}

function patchFiles(stdout: unknown): string | null {
  if (typeof stdout !== 'string') return null;
  const files = stdout
    .split('\n')
    .map((l) => l.match(/^[AMD]\s+(.+)$/)?.[1])
    .filter(Boolean) as string[];
  if (!files.length) return null;
  return files.map((f) => path.basename(f)).slice(0, 3).join(', ');
}

/**
 * Status from the rollout tail, by turn lifecycle (turn_id). A task_started with no
 * matching task_complete/turn_aborted means a turn is running -> busy. Note: Codex with
 * approval_policy=never emits no approval events, so reliable "waiting" detection is not
 * generally possible — we don't fabricate it.
 */
export function classifyCodexStatus(records: any[]): { status: AgentStatus; statusDetail: string | null } {
  const open = new Set<string>();
  let lastCmd: string | null = null;
  let aborted = false;
  let sawTerminal = false;

  for (const rec of records) {
    if (rec?.type === 'event_msg') {
      const p = rec.payload ?? {};
      switch (p.type) {
        case 'task_started':
          if (p.turn_id) open.add(p.turn_id);
          aborted = false;
          break;
        case 'task_complete':
          if (p.turn_id) open.delete(p.turn_id);
          sawTerminal = true;
          break;
        case 'turn_aborted':
          if (p.turn_id) open.delete(p.turn_id);
          aborted = true;
          sawTerminal = true;
          break;
        case 'patch_apply_end': {
          const f = patchFiles(p.stdout);
          if (f) lastCmd = `edited ${f}`;
          break;
        }
      }
    } else if (rec?.type === 'response_item' && rec.payload?.type === 'function_call') {
      const c = execCmd(rec.payload);
      if (c) lastCmd = `$ ${c}`;
    }
  }

  if (open.size > 0) return { status: 'busy', statusDetail: lastCmd ?? 'working' };
  if (aborted) return { status: 'idle', statusDetail: 'turn aborted' };
  if (sawTerminal) return { status: 'idle', statusDetail: null };
  return { status: 'unknown', statusDetail: null };
}

export interface CodexFields {
  lastMessage: string | null;
  lastUserPrompt: string | null;
  lastAction: string | null;
  tokens: number | null;
  contextWindow: number | null;
  runtime: Runtime;
  history: HistoryEntry[];
  lastTs: number | null;
}

export function extractCodexFields(records: any[]): CodexFields {
  let lastMessage: string | null = null;
  let lastUserPrompt: string | null = null;
  let lastAction: string | null = null;
  let tokens: number | null = null;
  let contextWindow: number | null = null;
  let runtime: Runtime = 'unknown';
  let lastTs: number | null = null;
  const history: HistoryEntry[] = [];

  for (const rec of records) {
    const recTs = parseTsToEpochMs(rec?.timestamp) ?? 0;
    if (recTs && (lastTs === null || recTs > lastTs)) lastTs = recTs;

    if (rec?.type === 'session_meta') {
      const p = rec.payload ?? {};
      runtime = runtimeFromOriginator(p.originator, p.source);
    } else if (rec?.type === 'event_msg') {
      const p = rec.payload ?? {};
      switch (p.type) {
        case 'agent_message':
          if (p.message?.trim()) {
            lastMessage = snippet(p.message, 400);
            history.push({ ts: recTs, kind: 'message', label: snippet(p.message) });
          }
          break;
        case 'user_message':
          if (p.message?.trim()) {
            lastUserPrompt = snippet(p.message, 400); // most recent human message (last write wins)
            history.push({ ts: recTs, kind: 'user', label: snippet(p.message) });
          }
          break;
        case 'token_count': {
          const info = p.info ?? {};
          const last = info.last_token_usage?.total_tokens;
          if (typeof last === 'number') tokens = last;
          if (typeof info.model_context_window === 'number') contextWindow = info.model_context_window;
          break;
        }
        case 'patch_apply_end': {
          const f = patchFiles(p.stdout);
          if (f) {
            lastAction = `edited ${f}`;
            history.push({ ts: recTs, kind: 'tool', label: lastAction });
          }
          break;
        }
        case 'context_compacted':
          history.push({ ts: recTs, kind: 'compaction', label: 'context compacted' });
          break;
      }
    } else if (rec?.type === 'response_item' && rec.payload?.type === 'function_call') {
      const c = execCmd(rec.payload);
      if (c) {
        lastAction = `$ ${c}`;
        history.push({ ts: recTs, kind: 'tool', label: lastAction });
      }
    }
  }

  return { lastMessage, lastUserPrompt, lastAction, tokens, contextWindow, runtime, history: history.slice(-HISTORY_LIMIT), lastTs };
}

export function buildCodexAgent(thread: CodexThread, records: any[], mtimeMs: number, headOriginator?: string | null): AgentRecord {
  const f = extractCodexFields(records);
  const { status, statusDetail } = classifyCodexStatus(records);
  // session_meta lives at the file start; for completed threads it's outside the tail window,
  // so fall back to an originator read from the head (passed in by the collector).
  const runtime = f.runtime !== 'unknown' ? f.runtime : runtimeFromOriginator(headOriginator, thread.source);
  const dbUpdated = thread.updated_at_ms ?? toEpochMs(thread.updated_at ?? null);
  const job = thread.title?.trim() || thread.first_user_message || thread.preview || 'Untitled thread';
  return {
    id: thread.id,
    tool: 'codex',
    runtime,
    cwd: thread.cwd,
    worktree: thread.cwd ? path.basename(thread.cwd) : '',
    branch: thread.git_branch,
    job: snippet(job, 120),
    status,
    statusDetail,
    liveness: 'unknown',
    livenessBasis: '',
    lastAction: f.lastAction,
    lastMessage: f.lastMessage,
    lastUserPrompt: f.lastUserPrompt ?? thread.first_user_message ?? null,
    history: f.history,
    tokens: f.tokens,
    contextWindow: f.contextWindow,
    model: thread.model,
    subagentsActive: null,
    idleSec: null,
    startedAt: null,
    updatedAt: dbUpdated ?? f.lastTs ?? mtimeMs,
    prLink: null,
    permissionMode: null,
    brief: null,
    pr: null,
    sourceFile: thread.rollout_path,
    rawTail: null,
    pinned: false,
    jobName: null,
    dismissed: false,
    notes: null,
    order: 0,
  };
}

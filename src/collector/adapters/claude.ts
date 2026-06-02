import path from 'node:path';
import { parseTsToEpochMs } from '../time';
import { HISTORY_LIMIT } from '../../shared/config';
import type { AgentRecord, AgentStatus, HistoryEntry } from '../../shared/types';

// Tools whose unmatched tool_use means the agent is blocked on the human.
const WAITING_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
// Tools that legitimately run in the background and can stay unmatched while the
// main thread has already yielded (end_turn). They must NOT make a session look busy.
const BACKGROUND_TOOLS = new Set(['Agent', 'Task']);

interface ToolUseLite {
  id: string;
  name: string;
  target: string | null;
  idx: number;
}

function snippet(s: unknown, n = 120): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
}

function toolTarget(name: string, input: any): string | null {
  if (!input || typeof input !== 'object') return null;
  if (name === 'AskUserQuestion') {
    const q = input.questions?.[0]?.question ?? input.question;
    return q ? snippet(q, 100) : 'needs your input';
  }
  if (name === 'ExitPlanMode') return 'plan ready for review';
  const t = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.description ?? input.prompt ?? input.url;
  return t != null ? snippet(t, 90) : null;
}

function renderAction(name: string, target: string | null): string {
  return target ? `${name}: ${target}` : name;
}

function findUrl(rec: any): string | null {
  for (const v of Object.values(rec)) {
    if (typeof v === 'string') {
      const m = v.match(/https?:\/\/\S+/);
      if (m) return m[0];
    }
  }
  return null;
}

/** A `user` record that represents a real human prompt (not a tool_result / synthetic injection). */
function isHumanPrompt(rec: any): boolean {
  if (rec?.type !== 'user') return false;
  const c = rec.message?.content;
  if (typeof c === 'string') {
    const s = c.trim();
    return s.length > 0 && !s.startsWith('<'); // skip <system-reminder> style injections
  }
  if (Array.isArray(c)) {
    const hasToolResult = c.some((b: any) => b?.type === 'tool_result');
    const hasText = c.some((b: any) => b?.type === 'text');
    return hasText && !hasToolResult;
  }
  return false;
}

/** The raw text of a human prompt, whether stored as a string or a text content-block. */
function humanPromptText(rec: any): string | null {
  const c = rec?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.find((b: any) => b?.type === 'text')?.text ?? null;
  return null;
}

/**
 * Derive current status from the MAIN transcript tail. The cardinal rule (from the
 * adversarial review): a session whose last assistant turn ended (end_turn) is IDLE
 * even if a background Agent/Task subagent is still streaming into a sidechain file.
 */
export function classifyClaudeStatus(records: any[]): { status: AgentStatus; statusDetail: string | null } {
  const toolUses: ToolUseLite[] = [];
  const resultIds = new Set<string>();
  let lastAssistantIdx = -1;
  let lastAssistant: any = null;
  let lastHumanPromptIdx = -1;
  let errorDetail: string | null = null;
  let permissionMode: string | null = null;

  records.forEach((rec, idx) => {
    const t = rec?.type;
    if (rec?.permissionMode) permissionMode = rec.permissionMode;
    if (t === 'assistant') {
      lastAssistantIdx = idx;
      lastAssistant = rec;
      const content = rec.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === 'tool_use' && c.id) {
            toolUses.push({ id: c.id, name: c.name, target: toolTarget(c.name, c.input), idx });
          }
        }
      }
    } else if (t === 'user') {
      const content = rec.message?.content;
      if (Array.isArray(content)) {
        for (const c of content) if (c?.type === 'tool_result' && c.tool_use_id) resultIds.add(c.tool_use_id);
      }
      if (isHumanPrompt(rec)) lastHumanPromptIdx = idx;
    } else if (t === 'system') {
      if (rec.isApiErrorMessage || rec.subtype === 'api_error' || rec.level === 'error') {
        errorDetail = snippet(rec.content ?? rec.subtype ?? 'API error', 80);
      }
    }
  });

  const unmatched = toolUses.filter((t) => !resultIds.has(t.id));
  const lastStop: string | null = lastAssistant?.message?.stop_reason ?? null;

  // 1) explicit error
  if (errorDetail) return { status: 'error', statusDetail: errorDetail };

  // 2) blocked on the human (question / plan) — highest "needs you" priority
  const ask = unmatched.find((t) => WAITING_TOOLS.has(t.name));
  if (ask) return { status: 'waiting', statusDetail: ask.target ?? ask.name };

  // 3) a fresh human prompt arrived after the last assistant -> agent about to work
  if (lastHumanPromptIdx > lastAssistantIdx) return { status: 'busy', statusDetail: 'thinking…' };

  // 3.5) PLAN MODE: a session in plan mode is never idle — it's either researching
  // (a foreground tool is in flight -> busy) or it has presented its plan / a question
  // and is awaiting you (-> waiting). Plan-mode AskUserQuestion/ExitPlanMode prompts are
  // not always persisted to the transcript until answered, so we infer this from the mode.
  if (permissionMode === 'plan') {
    const inflight = unmatched.filter((t) => !BACKGROUND_TOOLS.has(t.name));
    if (inflight.length) {
      const t = inflight[inflight.length - 1]!;
      return { status: 'busy', statusDetail: renderAction(t.name, t.target) };
    }
    return { status: 'waiting', statusDetail: 'Plan mode — awaiting your input' };
  }

  // 4) main thread yielded -> idle, EVEN IF a background subagent is still unmatched
  if (lastStop === 'end_turn') return { status: 'idle', statusDetail: null };

  // 5) inline tool(s) currently in flight
  if (lastStop === 'tool_use') {
    const inflight = unmatched[unmatched.length - 1] ?? toolUses[toolUses.length - 1];
    return { status: 'busy', statusDetail: inflight ? renderAction(inflight.name, inflight.target) : 'running a tool' };
  }

  // 6) a non-background tool is unmatched without an end_turn -> busy
  const foreground = unmatched.filter((t) => !BACKGROUND_TOOLS.has(t.name));
  if (foreground.length) {
    const t = foreground[foreground.length - 1]!;
    return { status: 'busy', statusDetail: renderAction(t.name, t.target) };
  }

  // 7) inconclusive
  if (lastAssistantIdx >= 0) return { status: 'idle', statusDetail: null };
  return { status: 'unknown', statusDetail: null };
}

export interface ClaudeFields {
  job: string;
  lastPrompt: string | null;
  lastUserPrompt: string | null;
  model: string | null;
  tokens: number | null;
  lastAction: string | null;
  lastMessage: string | null;
  prLink: string | null;
  permissionMode: string | null;
  entrypoint: string | null;
  history: HistoryEntry[];
  lastTs: number | null;
  cwd: string | null;
  branch: string | null;
}

export function extractClaudeFields(records: any[]): ClaudeFields {
  let job: string | null = null;
  let lastPrompt: string | null = null;
  let lastUserPrompt: string | null = null;
  let model: string | null = null;
  let tokens: number | null = null;
  let lastAction: string | null = null;
  let lastMessage: string | null = null;
  let prLink: string | null = null;
  let permissionMode: string | null = null;
  let entrypoint: string | null = null;
  let lastTs: number | null = null;
  let cwd: string | null = null;
  let branch: string | null = null;
  let firstUserPrompt: string | null = null;
  const history: HistoryEntry[] = [];

  for (const rec of records) {
    const t = rec?.type;
    const recTs = parseTsToEpochMs(rec?.timestamp) ?? 0;
    if (recTs && (lastTs === null || recTs > lastTs)) lastTs = recTs;
    if (rec?.cwd) cwd = rec.cwd;
    if (rec?.gitBranch) branch = rec.gitBranch;
    if (rec?.permissionMode) permissionMode = rec.permissionMode;
    if (rec?.entrypoint) entrypoint = rec.entrypoint;

    if (t === 'ai-title' && rec.aiTitle) {
      job = rec.aiTitle;
    } else if (t === 'last-prompt' && rec.lastPrompt) {
      lastPrompt = rec.lastPrompt;
      history.push({ ts: recTs, kind: 'user', label: snippet(rec.lastPrompt) });
    } else if (t === 'pr-link') {
      const url = findUrl(rec);
      if (url) {
        prLink = url;
        history.push({ ts: recTs, kind: 'pr', label: url });
      }
    } else if (t === 'assistant') {
      const m = rec.message ?? {};
      if (m.model) model = m.model;
      const u = m.usage;
      if (u) tokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      const content = m.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c?.type === 'text' && c.text?.trim()) {
            lastMessage = snippet(c.text, 400);
            history.push({ ts: recTs, kind: 'message', label: snippet(c.text) });
          } else if (c?.type === 'tool_use') {
            lastAction = renderAction(c.name, toolTarget(c.name, c.input));
            history.push({ ts: recTs, kind: BACKGROUND_TOOLS.has(c.name) ? 'subagent' : 'tool', label: lastAction });
          }
        }
      }
    } else if (t === 'user' && isHumanPrompt(rec)) {
      const txt = humanPromptText(rec);
      if (txt != null) {
        if (firstUserPrompt === null) firstUserPrompt = txt;
        lastUserPrompt = snippet(txt, 400); // most recent human message (last write wins)
      }
    }
  }

  if (!job) job = lastPrompt || firstUserPrompt || 'Untitled session';
  return {
    job: snippet(job, 120),
    lastPrompt,
    lastUserPrompt,
    model,
    tokens,
    lastAction,
    lastMessage,
    prLink,
    permissionMode,
    entrypoint,
    history: history.slice(-HISTORY_LIMIT),
    lastTs,
    cwd,
    branch,
  };
}

/** A real session transcript: top-level UUID-named .jsonl, not a subagent/workflow sidechain. */
export function isClaudeSessionFile(file: string): boolean {
  const base = path.basename(file);
  if (!base.endsWith('.jsonl')) return false;
  if (base.startsWith('agent-') || base === 'journal.jsonl') return false;
  if (file.includes('/subagents/') || file.includes('/workflows/')) return false;
  return /^[0-9a-f-]{36}\.jsonl$/i.test(base);
}

/** Assemble the transcript-derived portion of an AgentRecord. Liveness, git, subagent
 *  count, idleSec and user-metadata are layered on later by the collector. */
export function buildClaudeAgent(file: string, records: any[], mtimeMs: number): AgentRecord {
  const id = path.basename(file).replace(/\.jsonl$/, '');
  const f = extractClaudeFields(records);
  const { status, statusDetail } = classifyClaudeStatus(records);
  const cwd = f.cwd ?? '';
  return {
    id,
    tool: 'claude',
    runtime: 'terminal',
    cwd,
    worktree: cwd ? path.basename(cwd) : '',
    branch: f.branch,
    job: f.job,
    status,
    statusDetail,
    liveness: 'unknown',
    livenessBasis: '',
    lastAction: f.lastAction,
    lastMessage: f.lastMessage,
    lastUserPrompt: f.lastUserPrompt ?? f.lastPrompt,
    history: f.history,
    tokens: f.tokens,
    contextWindow: null,
    model: f.model,
    subagentsActive: null,
    idleSec: null,
    startedAt: null,
    updatedAt: f.lastTs ?? mtimeMs,
    prLink: f.prLink,
    permissionMode: f.permissionMode,
    brief: null,
    pr: null,
    sourceFile: file,
    rawTail: null,
    pinned: false,
    jobName: null,
    dismissed: false,
    blocked: false,
    notes: null,
    order: 0,
  };
}

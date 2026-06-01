import { describe, it, expect } from 'vitest';
import { classifyCodexStatus, extractCodexFields, buildCodexAgent, type CodexThread } from '../src/collector/adapters/codex';

const ts = (s: string) => `2026-05-28T07:${s}Z`;
const sessionMeta = (originator: string, cwd: string) => ({ timestamp: ts('47:08'), type: 'session_meta', payload: { id: 'x', timestamp: ts('47:08'), cwd, originator, source: 'vscode' } });
const taskStarted = (turn_id: string) => ({ timestamp: ts('48:00'), type: 'event_msg', payload: { type: 'task_started', turn_id, started_at: 1780002733, model_context_window: 258400 } });
const taskComplete = (turn_id: string, msg: string) => ({ timestamp: ts('49:00'), type: 'event_msg', payload: { type: 'task_complete', turn_id, last_agent_message: msg, completed_at: 1780003084, duration_ms: 350395 } });
const turnAborted = (turn_id: string) => ({ timestamp: ts('49:30'), type: 'event_msg', payload: { type: 'turn_aborted', turn_id } });
const execCall = (cmd: string) => ({ timestamp: ts('48:30'), type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd, workdir: '/x' }), call_id: 'c1' } });
const agentMsg = (m: string) => ({ timestamp: ts('48:50'), type: 'event_msg', payload: { type: 'agent_message', message: m, phase: 'final_answer' } });
const tokenCount = () => ({ timestamp: ts('48:55'), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 64919512 }, last_token_usage: { total_tokens: 126398 }, model_context_window: 258400 } } });

const thread: CodexThread = {
  id: '019e6d8d-2869-7f51-9c32-82cbfd9eeae7',
  cwd: '/Users/tomscrace/neevie-wt-5',
  git_branch: 'mcp',
  title: 'Wire up the experimental agent',
  archived: 0,
  updated_at_ms: 1780003084027,
  model: 'gpt-5.5',
  tokens_used: 64919512,
  rollout_path: '/Users/tomscrace/.codex/sessions/2026/05/28/rollout-x.jsonl',
  source: 'vscode',
};

describe('classifyCodexStatus', () => {
  it('a turn that started and completed -> idle', () => {
    const recs = [taskStarted('t1'), execCall('npm test'), agentMsg('done'), taskComplete('t1', 'done')];
    expect(classifyCodexStatus(recs).status).toBe('idle');
  });

  it('a turn started with no matching complete -> busy, with the running command as detail', () => {
    const recs = [taskComplete('t0', 'prev'), taskStarted('t1'), execCall('pytest -q')];
    const r = classifyCodexStatus(recs);
    expect(r.status).toBe('busy');
    expect(r.statusDetail).toContain('pytest');
  });

  it('a turn aborted -> idle (stopped, not running)', () => {
    const recs = [taskStarted('t1'), turnAborted('t1')];
    expect(classifyCodexStatus(recs).status).toBe('idle');
  });
});

describe('extractCodexFields', () => {
  const recs = [sessionMeta('Codex Desktop', '/Users/tomscrace/neevie-wt-5'), taskStarted('t1'), execCall('rg experimental'), agentMsg('This confirms the issue.'), tokenCount(), taskComplete('t1', 'This confirms the issue.')];
  it('reads current context occupancy from last_token_usage (not the cumulative total)', () => {
    const f = extractCodexFields(recs);
    expect(f.tokens).toBe(126398);
    expect(f.contextWindow).toBe(258400);
  });
  it('captures the last agent message and last action', () => {
    const f = extractCodexFields(recs);
    expect(f.lastMessage).toContain('confirms the issue');
    expect(f.lastAction).toContain('rg experimental');
  });
  it('detects the app runtime from session_meta.originator', () => {
    expect(extractCodexFields(recs).runtime).toBe('app');
  });

  it('captures the most recent user_message as lastUserPrompt', () => {
    const userMessage = (m: string) => ({ timestamp: ts('48:10'), type: 'event_msg', payload: { type: 'user_message', message: m } });
    const r2 = [userMessage('do X'), agentMsg('working'), userMessage('actually do Y')];
    expect(extractCodexFields(r2).lastUserPrompt).toBe('actually do Y');
  });
});

describe('buildCodexAgent', () => {
  const recs = [sessionMeta('Codex Desktop', '/Users/tomscrace/neevie-wt-5'), taskStarted('t1'), execCall('npm test'), agentMsg('ok'), tokenCount(), taskComplete('t1', 'ok')];
  it('uses the DB thread as the authoritative source for job/branch/cwd/model', () => {
    const a = buildCodexAgent(thread, recs, 1780003084027);
    expect(a.tool).toBe('codex');
    expect(a.job).toBe('Wire up the experimental agent');
    expect(a.branch).toBe('mcp');
    expect(a.worktree).toBe('neevie-wt-5');
    expect(a.model).toBe('gpt-5.5');
    expect(a.runtime).toBe('app');
    expect(a.id).toBe(thread.id);
  });
});

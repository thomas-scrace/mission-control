import { describe, it, expect } from 'vitest';
import { classifyClaudeStatus, extractClaudeFields } from '../src/collector/adapters/claude';

// Minimal record builders matching the real v2.1.x Claude transcript shapes.
const ts = (s: string) => `2026-05-29T10:${s}Z`;
const assistant = (stop_reason: string, content: any[], extra: any = {}) => ({
  type: 'assistant',
  timestamp: ts('00:00'),
  message: { role: 'assistant', model: 'claude-opus-4-8', stop_reason, content, usage: { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 50000, output_tokens: 300 }, ...extra },
});
const toolUse = (id: string, name: string, input: any) => ({ type: 'tool_use', id, name, input });
const text = (t: string) => ({ type: 'text', text: t });
const thinking = (t: string) => ({ type: 'thinking', thinking: t });
const toolResult = (id: string, is_error = false) => ({
  type: 'user',
  timestamp: ts('00:01'),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error, content: 'ok' }] },
});
const aiTitle = (t: string) => ({ type: 'ai-title', aiTitle: t });
const lastPrompt = (t: string) => ({ type: 'last-prompt', lastPrompt: t });

describe('classifyClaudeStatus', () => {
  it('end_turn with no pending tools -> idle', () => {
    const recs = [assistant('tool_use', [toolUse('1', 'Bash', { command: 'ls' })]), toolResult('1'), assistant('end_turn', [text('All done.')])];
    expect(classifyClaudeStatus(recs).status).toBe('idle');
  });

  it('last assistant stop_reason tool_use with an unmatched inline tool -> busy with tool detail', () => {
    const recs = [assistant('tool_use', [toolUse('9', 'Bash', { command: 'npm run build' })])];
    const r = classifyClaudeStatus(recs);
    expect(r.status).toBe('busy');
    expect(r.statusDetail).toContain('npm run build');
  });

  it('unmatched AskUserQuestion -> waiting (needs you), with the question as detail', () => {
    const recs = [assistant('tool_use', [toolUse('q1', 'AskUserQuestion', { questions: [{ question: 'Which DB should we use?' }] })])];
    const r = classifyClaudeStatus(recs);
    expect(r.status).toBe('waiting');
    expect(r.statusDetail).toContain('Which DB');
  });

  it('ExitPlanMode pending -> waiting', () => {
    const recs = [assistant('tool_use', [toolUse('p1', 'ExitPlanMode', { plan: 'Step 1...' })])];
    expect(classifyClaudeStatus(recs).status).toBe('waiting');
  });

  // THE CRITICAL CASE the critic surfaced: main thread finished (end_turn) but a
  // background Agent/Task tool_use is still unmatched. Must be IDLE, never BUSY.
  it('end_turn + unmatched background Agent subagent -> idle (NOT busy)', () => {
    const recs = [
      assistant('tool_use', [toolUse('bg', 'Agent', { description: 'Score issue A', run_in_background: true })]),
      assistant('end_turn', [text('Kicked off the scorer; let me know what else.')]),
    ];
    expect(classifyClaudeStatus(recs).status).toBe('idle');
  });

  it('api error near tail -> error', () => {
    const recs = [assistant('end_turn', [text('working')]), { type: 'system', subtype: 'api_error', level: 'error', isApiErrorMessage: true, content: 'overloaded' }];
    expect(classifyClaudeStatus(recs).status).toBe('error');
  });

  it('a fresh human prompt after the last assistant -> busy (agent about to work)', () => {
    const recs = [assistant('end_turn', [text('done')]), { type: 'user', timestamp: ts('05:00'), message: { role: 'user', content: 'now add tests please' } }];
    expect(classifyClaudeStatus(recs).status).toBe('busy');
  });
});

// Plan mode: AskUserQuestion / plan prompts aren't always written to the transcript until
// answered, so the only on-disk signal can be EnterPlanMode. A session in plan mode is never
// "idle" — it's researching (busy) or awaiting you (waiting).
describe('classifyClaudeStatus — plan mode', () => {
  const permMode = (m: string) => ({ type: 'permission-mode', permissionMode: m });

  it('entered plan mode and yielded (EnterPlanMode matched, no tool in flight) -> waiting', () => {
    const recs = [assistant('tool_use', [toolUse('ep', 'EnterPlanMode', {})]), toolResult('ep'), permMode('plan')];
    expect(classifyClaudeStatus(recs).status).toBe('waiting');
  });

  it('in plan mode, ended a turn presenting the plan as text -> waiting', () => {
    const recs = [assistant('end_turn', [text('Here is the plan…')]), permMode('plan')];
    expect(classifyClaudeStatus(recs).status).toBe('waiting');
  });

  it('in plan mode while researching (a tool is in flight) -> busy', () => {
    const recs = [permMode('plan'), assistant('tool_use', [toolUse('g', 'Grep', { pattern: 'foo' })])];
    expect(classifyClaudeStatus(recs).status).toBe('busy');
  });

  it('a fresh human prompt in plan mode (you just answered) -> busy, not waiting', () => {
    const recs = [permMode('plan'), assistant('tool_use', [toolUse('ep', 'EnterPlanMode', {})]), toolResult('ep'), { type: 'user', timestamp: ts('06:00'), message: { role: 'user', content: 'go with option 1' } }];
    expect(classifyClaudeStatus(recs).status).toBe('busy');
  });
});

describe('extractClaudeFields', () => {
  const recs = [
    aiTitle('Old title'),
    assistant('tool_use', [toolUse('1', 'Read', { file_path: '/x/y/Row.tsx' })]),
    toolResult('1'),
    lastPrompt('please refactor the row component'),
    aiTitle('Refactor Row component'),
    assistant('end_turn', [thinking('hmm'), text('Refactored Row.tsx and trimmed props.')]),
  ];

  it('uses the latest ai-title as the job', () => {
    expect(extractClaudeFields(recs).job).toBe('Refactor Row component');
  });
  it('captures the last assistant prose (not thinking) as lastMessage', () => {
    expect(extractClaudeFields(recs).lastMessage).toContain('Refactored Row.tsx');
  });
  it('captures the last tool call as lastAction', () => {
    expect(extractClaudeFields(recs).lastAction).toContain('Row.tsx');
  });
  it('reports the model and a positive token count', () => {
    const f = extractClaudeFields(recs);
    expect(f.model).toBe('claude-opus-4-8');
    expect(f.tokens).toBeGreaterThan(0);
  });
});

describe('extractClaudeFields lastUserPrompt', () => {
  const userPrompt = (t: string) => ({ type: 'user', timestamp: ts('00:00'), message: { role: 'user', content: t } });

  it('captures the most recent HUMAN message, ignoring intervening tool_results', () => {
    const recs = [
      userPrompt('first thing'),
      assistant('tool_use', [toolUse('1', 'Bash', { command: 'ls' })]),
      toolResult('1'), // a `user` record, but a tool_result — must NOT be picked
      userPrompt('second thing please'),
      assistant('tool_use', [toolUse('q', 'AskUserQuestion', { questions: [{ question: 'which?' }] })]),
    ];
    expect(extractClaudeFields(recs).lastUserPrompt).toBe('second thing please');
  });

  it('reads array-form text content too', () => {
    const recs = [userPrompt('old'), { type: 'user', timestamp: ts('01:00'), message: { role: 'user', content: [text('use array form')] } }];
    expect(extractClaudeFields(recs).lastUserPrompt).toBe('use array form');
  });

  it('is null when there is no human prompt', () => {
    const recs = [assistant('end_turn', [text('hi')]), toolResult('1')];
    expect(extractClaudeFields(recs).lastUserPrompt).toBeNull();
  });
});

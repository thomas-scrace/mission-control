import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  MC_DIR,
  SYNTH_ENABLED,
  SYNTH_MODEL,
  SYNTH_DIR,
  SYNTH_CONCURRENCY,
  SYNTH_MIN_INTERVAL_MS,
  SYNTH_TRANSITION_MS,
  SYNTH_FRESH_MS,
} from '../shared/config';
import type { AgentRecord, AgentBrief, Phase } from '../shared/types';
import { getBrief, setBrief } from './meta';

const execFileAsync = promisify(execFile);

// Stable instructions live in the system prompt so the Anthropic prompt cache (5-min TTL)
// covers them across a sweep — only the small per-agent digest varies.
const SYSTEM_PROMPT = `You summarize the live state of an AI coding agent's session for an at-a-glance dashboard. You receive a DIGEST of the recent transcript. Reply with ONLY a JSON object (no prose, no markdown fences) with exactly these keys:
{"title": string, "summary": string, "phase": string, "needsYou": boolean, "needsReason": string, "lastAsk": string, "nextStep": string, "simplified": boolean, "reviewed": boolean}
Definitions:
- title: a CLEAR, SPECIFIC name for what this task is actually doing — a short phrase a human can understand at a glance, up to ~7 words, sentence case. Read the recent activity and the user's request and name the real objective, not a generic label. Prefer specificity over brevity. GOOD: "Dedupe debounced input-event types", "Fix Smartlead PR review flow", "Migrate colour tokens to Tailwind v4", "Add full-text search to docs". BAD (too vague/cryptic): "Type Dedup Deploy", "UI fix", "Update code". No trailing period.
- summary: ONE plain-language sentence naming the overall project/task this agent is working on. No file paths, no jargon. (≤16 words)
- phase: the current workflow stage, EXACTLY one of: "planning", "execution", "testing", "simplification", "code-review", "release". Trust the PHASE HINTS provided.
- needsYou: true ONLY if the agent is blocked waiting on the human — a question, a plan to approve, a decision, or an error it cannot resolve alone. An agent that is still working is needsYou=false.
- needsReason: if needsYou is true, a short phrase for what it needs; otherwise "".
- lastAsk: paraphrase the most recent thing the human asked the agent to do — this should always be filled in for a paused agent (≤14 words).
- nextStep: the single clearest next action — what the agent will do next, or what the human must do if it's blocked (≤14 words).
- simplified: true if, on the MOST RECENT batch of work, a code-simplifier / refactor-for-clarity pass has already been run (see the simplification PHASE HINT and the activity). Otherwise false.
- reviewed: true if, on the MOST RECENT batch of work, a code review (e.g. /code-review) has already been run (see the code-review PHASE HINT and the activity). Otherwise false.
Output JSON only.`;

const PHASES_OK = new Set<Phase>(['planning', 'execution', 'testing', 'simplification', 'code-review', 'release']);

/** A short hash of the fields that, when changed, warrant re-synthesis. */
const PROMPT_VERSION = 'v3'; // bump when the synthesis prompt/schema changes, to invalidate cached briefs

export function contentHash(a: AgentRecord): string {
  // Include model + prompt version so switching them invalidates cached briefs.
  const key = [PROMPT_VERSION, SYNTH_MODEL, a.status, a.statusDetail, a.lastAction, a.lastMessage, a.job, a.history.length].join('|');
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

/** Scan recent activity for markers of each phase (esp. the user's code-simplifier / code-review skills). */
function phaseHints(a: AgentRecord): string {
  const text = [a.lastAction ?? '', a.statusDetail ?? '', ...a.history.map((h) => h.label)].join('\n').toLowerCase();
  const hit = (re: RegExp) => (re.test(text) ? 'yes' : 'no');
  return [
    `planning=${hit(/exitplanmode|enterplanmode|\bplan mode\b|\bplanning\b/)}`,
    `testing=${hit(/\b(vitest|pytest|jest|npm test|go test|\bunit test|run the tests?)\b/)}`,
    `simplification=${hit(/code[- ]?simplif|\/simplify|simplify the code|refactor for clarity/)}`,
    `code-review=${hit(/\/code-review|code[- ]?review|security[- ]?review|\/review\b/)}`,
    `release=${hit(/git push|gh pr|pull request|\bmerge(d)?\b|deploy|release|git commit/)}`,
  ].join(', ');
}

function digest(a: AgentRecord): string {
  const recent = a.history.slice(-22).map((h) => `- ${h.kind}: ${h.label}`).join('\n');
  return [
    `TOOL: ${a.tool} | WORKTREE: ${a.worktree || '?'} | BRANCH: ${a.branch || '?'}`,
    `TITLE: ${a.jobName || a.job}`,
    `MECHANICAL STATUS: ${a.status}${a.statusDetail ? ` (${a.statusDetail})` : ''}`,
    `PHASE HINTS: ${phaseHints(a)}`,
    `RECENT ACTIVITY (oldest→newest):`,
    recent || '- (no recorded activity)',
    a.lastMessage ? `LAST ASSISTANT MESSAGE: ${a.lastMessage.slice(0, 400)}` : '',
  ].filter(Boolean).join('\n');
}

function parseBrief(resultText: string): AgentBrief {
  const cleaned = resultText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const obj = JSON.parse(cleaned);
  const phase = PHASES_OK.has(obj.phase) ? (obj.phase as Phase) : null;
  return {
    title: String(obj.title ?? '').replace(/[.\s]+$/, '').slice(0, 64),
    summary: String(obj.summary ?? '').slice(0, 200),
    phase,
    needsYou: !!obj.needsYou,
    needsReason: obj.needsReason ? String(obj.needsReason).slice(0, 160) : null,
    lastAsk: obj.lastAsk ? String(obj.lastAsk).slice(0, 200) : null,
    nextStep: obj.nextStep ? String(obj.nextStep).slice(0, 200) : null,
    simplified: !!obj.simplified,
    reviewed: !!obj.reviewed,
    at: Date.now(),
    state: 'ready',
  };
}

async function callClaude(prompt: string): Promise<string> {
  await mkdir(SYNTH_DIR, { recursive: true });
  const { stdout } = await execFileAsync(
    'claude',
    [
      '-p', prompt,
      '--output-format', 'json',
      '--model', SYNTH_MODEL,
      '--system-prompt', SYSTEM_PROMPT,
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--disallowedTools', 'Task,Bash,Glob,Grep,Read,Edit,Write,WebFetch,WebSearch,NotebookEdit,TodoWrite',
    ],
    { cwd: SYNTH_DIR, timeout: 45_000, maxBuffer: 8 * 1024 * 1024 },
  );
  const res = JSON.parse(stdout);
  if (res.is_error) throw new Error(res.result ?? 'synthesis error');
  return res.result ?? '';
}

async function synthesize(agent: AgentRecord): Promise<AgentBrief> {
  return parseBrief(await callClaude(digest(agent)));
}

// ── scheduler: concurrency gate + per-agent dedupe ──
const inflight = new Set<string>();
const lastAttempt = new Map<string, number>();
const lastStatus = new Map<string, string>();
let active = 0;
const pending: Array<() => void> = [];

function pump(): void {
  while (active < SYNTH_CONCURRENCY && pending.length) {
    const job = pending.shift()!;
    active++;
    job();
  }
}

function schedule(job: () => Promise<void>): void {
  pending.push(() => {
    void job().finally(() => {
      active--;
      pump();
    });
  });
  pump();
}

export type ApplyBrief = (id: string, brief: AgentBrief) => void;

/**
 * Decide whether `agent` needs a (re)synthesis and, if so, run it (respecting concurrency,
 * freshness, per-agent interval, and a persisted-by-content-hash cache). `apply` is called
 * with the resulting brief so the collector can update the store + push over SSE.
 */
export function considerSynthesis(agent: AgentRecord, apply: ApplyBrief): void {
  if (!SYNTH_ENABLED) return;
  if (agent.cwd && agent.cwd.startsWith(MC_DIR)) return; // never synthesize our own synth sessions
  if (agent.dismissed) return;

  const fresh = agent.liveness === 'live' || Date.now() - agent.updatedAt < SYNTH_FRESH_MS;
  if (!fresh) return;

  const hash = contentHash(agent);

  // Reuse a persisted brief if the content hasn't changed.
  const persisted = getBrief(agent.id);
  if (persisted && persisted.hash === hash) {
    if (!agent.brief || agent.brief.at !== persisted.brief.at) apply(agent.id, persisted.brief);
    return;
  }

  if (inflight.has(agent.id)) return;
  // Refresh promptly when the agent's status just changed (e.g. busy→idle, →waiting); otherwise
  // hold to the steady-state interval. This keeps the narrative current at the moments that matter.
  const statusChanged = lastStatus.get(agent.id) !== agent.status;
  const floor = statusChanged ? SYNTH_TRANSITION_MS : SYNTH_MIN_INTERVAL_MS;
  if (Date.now() - (lastAttempt.get(agent.id) ?? 0) < floor) return;

  inflight.add(agent.id);
  lastAttempt.set(agent.id, Date.now());
  lastStatus.set(agent.id, agent.status);

  // Show "synthesizing…" if we have nothing yet (don't flicker an existing brief).
  if (!agent.brief) apply(agent.id, emptyBrief('pending'));

  schedule(async () => {
    try {
      const brief = await synthesize(agent);
      setBrief(agent.id, hash, brief);
      apply(agent.id, brief);
    } catch {
      apply(agent.id, emptyBrief('error'));
    } finally {
      inflight.delete(agent.id);
    }
  });
}

function emptyBrief(state: AgentBrief['state']): AgentBrief {
  return { title: '', summary: '', phase: null, needsYou: false, needsReason: null, lastAsk: null, nextStep: null, simplified: false, reviewed: false, at: Date.now(), state };
}

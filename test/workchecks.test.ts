import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanWorkCheckMarkers, workChecksFor, forgetWorkChecks } from '../src/collector/workchecks';

const SIMPLIFIER = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'code-simplifier:code-simplifier' } }] } });
const REVIEW = '<command-name>/code-review:code-review</command-name>';

async function tmpFile(contents: string): Promise<string> {
  const p = path.join(os.tmpdir(), `wc-${Date.now()}-${Math.floor(Math.random() * 1e9)}.jsonl`);
  await fs.writeFile(p, contents);
  return p;
}

// `simplified` / `reviewed` are deterministic facts about a session: did a
// code-simplifier subagent and a /code-review run? We detect them from the raw
// transcript text (not the LLM, not the 512KB tail) so they survive the milestone
// scrolling out of the window. The scan must be PRECISE: merely *listing* the
// code-review skill as available must NOT count as having run it.
describe('scanWorkCheckMarkers', () => {
  it('detects a code-simplifier subagent run', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'code-simplifier:code-simplifier', prompt: 'simplify it' } }] },
    });
    expect(scanWorkCheckMarkers(line)).toEqual({ simplified: true, reviewed: false });
  });

  it('detects the /code-review slash command invocation', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { content: '<command-message>code-review:code-review</command-message>\n<command-name>/code-review:code-review</command-name>' },
    });
    expect(scanWorkCheckMarkers(line)).toEqual({ simplified: false, reviewed: true });
  });

  it('treats /ultrareview as a code review', () => {
    const line = '<command-name>/ultrareview</command-name>';
    expect(scanWorkCheckMarkers(line).reviewed).toBe(true);
  });

  it('detects a code-review(er) subagent run', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Task', input: { subagent_type: 'code-reviewer' } }] } });
    expect(scanWorkCheckMarkers(line).reviewed).toBe(true);
  });

  it('finds both across a multi-record transcript', () => {
    const text = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'code-simplifier:code-simplifier' } }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'lots of other work' }] } }),
      '<command-name>/code-review:code-review</command-name>',
    ].join('\n');
    expect(scanWorkCheckMarkers(text)).toEqual({ simplified: true, reviewed: true });
  });

  it('does NOT count merely listing the skills as available (no false positive)', () => {
    // The skill_listing attachment names every available skill, including these two.
    const listing = JSON.stringify({
      type: 'user',
      attachment: {
        type: 'skill_listing',
        content:
          '- code-review:code-review: Provide a code review for the given pull request.\n' +
          '- code-simplifier:code-simplifier: Simplifies and refines code for clarity.\n' +
          '- frontend-slides: Create stunning HTML presentations.',
      },
    });
    expect(scanWorkCheckMarkers(listing)).toEqual({ simplified: false, reviewed: false });
  });

  it('does NOT count an agent merely talking about review/simplification', () => {
    const prose = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'I will simplify the code and then we should review it carefully.' }] } });
    expect(scanWorkCheckMarkers(prose)).toEqual({ simplified: false, reviewed: false });
  });

  it('returns both false for empty input', () => {
    expect(scanWorkCheckMarkers('')).toEqual({ simplified: false, reviewed: false });
  });
});

describe('workChecksFor (incremental, sticky)', () => {
  it('picks up a marker appended after the first scan', async () => {
    const file = await tmpFile(SIMPLIFIER + '\n');
    try {
      expect(await workChecksFor(file)).toEqual({ simplified: true, reviewed: false });
      await fs.appendFile(file, 'a lot more activity here\n'.repeat(50) + REVIEW + '\n');
      expect(await workChecksFor(file)).toEqual({ simplified: true, reviewed: true });
    } finally {
      forgetWorkChecks(file);
      await fs.rm(file, { force: true });
    }
  });

  it('is sticky — stays found even after the file is removed', async () => {
    const file = await tmpFile(SIMPLIFIER + '\n' + REVIEW + '\n');
    try {
      expect(await workChecksFor(file)).toEqual({ simplified: true, reviewed: true });
      await fs.rm(file, { force: true });
      expect(await workChecksFor(file)).toEqual({ simplified: true, reviewed: true });
    } finally {
      forgetWorkChecks(file);
    }
  });

  it('rescans from the top when the file shrinks (rotation/truncation)', async () => {
    const file = await tmpFile('x'.repeat(5000) + '\n' + SIMPLIFIER + '\n');
    try {
      expect(await workChecksFor(file)).toEqual({ simplified: true, reviewed: false });
      // rewrite SHORTER, with the other marker — the offset cache must not skip it
      await fs.writeFile(file, REVIEW + '\n');
      expect((await workChecksFor(file)).reviewed).toBe(true);
    } finally {
      forgetWorkChecks(file);
      await fs.rm(file, { force: true });
    }
  });
});

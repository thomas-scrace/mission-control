import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tailLines, parseJsonl } from '../src/collector/tail';

const tmp = path.join(os.tmpdir(), `mc-tail-${process.pid}.jsonl`);

afterAll(async () => {
  await fs.rm(tmp, { force: true });
});

describe('tailLines', () => {
  it('returns all complete lines when the window covers the whole file', async () => {
    const content = ['{"a":1}', '{"a":2}', '{"a":3}'].join('\n') + '\n';
    await fs.writeFile(tmp, content);
    const res = await tailLines(tmp, 1024);
    expect(res.truncated).toBe(false);
    expect(res.lines).toEqual(['{"a":1}', '{"a":2}', '{"a":3}']);
  });

  it('drops the first partial line when the file exceeds the window', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => JSON.stringify({ n: i, pad: 'x'.repeat(40) }));
    await fs.writeFile(tmp, lines.join('\n') + '\n');
    const res = await tailLines(tmp, 200); // small window -> truncation
    expect(res.truncated).toBe(true);
    // Every returned line must be valid JSON (no half-line at the front).
    const parsed = parseJsonl<{ n: number }>(res.lines);
    expect(parsed.length).toBe(res.lines.length);
    // Must include the very last record.
    expect(parsed[parsed.length - 1]!.n).toBe(49);
  });
});

describe('parseJsonl', () => {
  it('skips malformed lines without throwing', () => {
    const out = parseJsonl<{ a: number }>(['{"a":1}', '{bad json', '{"a":2}']);
    expect(out).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

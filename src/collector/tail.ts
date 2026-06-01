import { promises as fs } from 'node:fs';
import { TAIL_BYTES } from '../shared/config';

export interface TailResult {
  lines: string[]; // complete JSONL lines from the tail window (oldest first)
  size: number; // total file size in bytes
  mtimeMs: number; // file modification time (epoch ms, OS-local clock)
  truncated: boolean; // true if we did not read from byte 0 (window smaller than file)
}

/**
 * Read only the last `maxBytes` of a (potentially huge) JSONL transcript.
 * If the file is larger than the window we drop the first, partial line so callers
 * only ever see complete records.
 */
export async function tailLines(file: string, maxBytes: number = TAIL_BYTES): Promise<TailResult> {
  const fh = await fs.open(file, 'r');
  try {
    const st = await fh.stat();
    const size = st.size;
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    const buf = Buffer.alloc(length);
    if (length > 0) await fh.read(buf, 0, length, start);
    let text = buf.toString('utf8');
    const truncated = start > 0;
    if (truncated) {
      const nl = text.indexOf('\n');
      text = nl >= 0 ? text.slice(nl + 1) : '';
    }
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    return { lines, size, mtimeMs: st.mtimeMs, truncated };
  } finally {
    await fh.close();
  }
}

/** Read and parse the FIRST JSON line of a file (e.g. Codex `session_meta`, which lives at the
 *  start and is only re-emitted at the tail for still-active sessions). */
export async function readFirstJson<T = any>(file: string, maxBytes = 8192): Promise<T | null> {
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    const text = buf.toString('utf8', 0, bytesRead);
    const firstLine = text.split('\n', 1)[0];
    if (!firstLine) return null;
    try {
      return JSON.parse(firstLine) as T;
    } catch {
      return null;
    }
  } finally {
    await fh.close();
  }
}

/** Parse JSONL lines, skipping any that fail to parse (transcripts can be mid-write). */
export function parseJsonl<T = unknown>(lines: string[]): T[] {
  const out: T[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // ignore partial / malformed lines
    }
  }
  return out;
}

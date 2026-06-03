import { promises as fs } from 'node:fs';

/**
 * Whether the user's two quality passes have been run on a session: the
 * `code-simplifier` subagent and a `/code-review` (a.k.a. `/ultrareview`).
 *
 * These are DETERMINISTIC facts read straight from the transcript, NOT guessed by
 * the synthesis LLM. The milestones that prove them (a Task/Agent `subagent_type`,
 * or a `<command-name>` invocation) routinely scroll out of the 512KB tail the rest
 * of the pipeline reads — code-review especially is verbose — so the LLM (which only
 * sees the tail) reports them as "not run". We instead scan the WHOLE file, once,
 * incrementally (see {@link workChecksFor}).
 */
export interface WorkChecks {
  simplified: boolean;
  reviewed: boolean;
}

// Precise invocation markers. We deliberately do NOT match bare words like "review"
// or "simplify": the skill_listing attachment names every available skill (including
// these two), and an agent can talk *about* reviewing — neither means a pass was run.
//   simplified: a subagent of type code-simplifier, or a /code-simplifier|/simplify command
//   reviewed:   a /code-review|/ultrareview command, or a code-review(er) subagent
const SIMPLIFIER_SUBAGENT = /"subagent_type"\s*:\s*"[^"]*code-simplifier/i;
const SIMPLIFIER_COMMAND = /<command-name>\s*\/?[^<]*(?:code-simplifier|simplify)/i;
const REVIEW_COMMAND = /<command-name>\s*\/?[^<]*(?:code-review|ultra-?review)/i;
const REVIEW_SUBAGENT = /"subagent_type"\s*:\s*"[^"]*code-review/i;

/** Pure: do these markers appear anywhere in the given transcript text? */
export function scanWorkCheckMarkers(text: string): WorkChecks {
  return {
    simplified: SIMPLIFIER_SUBAGENT.test(text) || SIMPLIFIER_COMMAND.test(text),
    reviewed: REVIEW_COMMAND.test(text) || REVIEW_SUBAGENT.test(text),
  };
}

// ── incremental, sticky per-file cache ──────────────────────────────────────
// Once a marker is found it stays found for the life of the session ("ran on this
// session's work"). We read each byte of a transcript at most once: subsequent
// sweeps scan only the bytes appended since last time. A small overlap stops a
// marker that straddles two reads from slipping through the seam.
interface Entry {
  offset: number; // bytes already scanned
  checks: WorkChecks;
}
const cache = new Map<string, Entry>();
const OVERLAP = 256; // ≥ the longest marker, so seams never split one
const CACHE_MAX = 2000;

function freshEntry(): Entry {
  return { offset: 0, checks: { simplified: false, reviewed: false } };
}

/**
 * Detect the two passes for a transcript file, reading only the new tail since the
 * last call. Sticky: returns early once both are found. Resilient: a shrunk file
 * (rotation/truncation) is rescanned from the top; an unreadable file yields the
 * last-known checks.
 */
export async function workChecksFor(file: string): Promise<WorkChecks> {
  const prev = cache.get(file) ?? freshEntry();
  if (prev.checks.simplified && prev.checks.reviewed) return prev.checks; // nothing left to find

  let size: number;
  try {
    size = (await fs.stat(file)).size;
  } catch {
    return prev.checks; // file vanished — keep what we know
  }

  let entry = prev;
  if (size < prev.offset) entry = freshEntry(); // truncated/rotated → rescan from 0
  const from = Math.max(0, entry.offset - OVERLAP);

  if (size > from) {
    try {
      const fh = await fs.open(file, 'r');
      try {
        const len = size - from;
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, from);
        const found = scanWorkCheckMarkers(buf.toString('utf8'));
        entry = {
          offset: size,
          checks: {
            simplified: entry.checks.simplified || found.simplified,
            reviewed: entry.checks.reviewed || found.reviewed,
          },
        };
      } finally {
        await fh.close();
      }
    } catch {
      return entry.checks; // transient read error — try again next sweep
    }
  } else {
    entry = { ...entry, offset: size };
  }

  cache.set(file, entry);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return entry.checks;
}

/** Drop a file's cached scan (used when a session disappears). Exposed for tests. */
export function forgetWorkChecks(file: string): void {
  cache.delete(file);
}

import type { WorktreeSlot } from '../../shared/types';
import { PrChip, Tag } from './PrStatus';
import { baseName, shortPath } from '../lib/format';

/**
 * The always-present slot identity row: worktree path label, branch, primary tag,
 * commit (dirty/clean) state, ahead/behind, and the branch's PR. Rendered for BOTH
 * empty and occupied slots so a slot reads consistently either way.
 */
export function SlotMeta({ slot }: { slot: WorktreeSlot }) {
  const name = baseName(slot.path);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-1.5 text-[11px]">
        <span className="truncate font-mono text-ink-dim" title={shortPath(slot.path)}>
          {name}
        </span>
        {slot.isPrimary && <Tag tone="muted">primary</Tag>}
        {slot.detached ? (
          <Tag tone="muted">detached</Tag>
        ) : slot.branch ? (
          <span className="flex min-w-0 items-baseline gap-1 font-mono text-ink-faint">
            <span className="text-ink-faint/60">·</span>
            <span className="truncate" title={slot.branch}>
              {slot.branch}
            </span>
          </span>
        ) : null}

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <CommitState dirty={slot.dirty} />
          <AheadBehind ahead={slot.ahead} behind={slot.behind} />
        </span>
      </div>

      {slot.pr && <PrChip pr={slot.pr} />}
    </div>
  );
}

function CommitState({ dirty }: { dirty: boolean | null }) {
  if (dirty == null) return null;
  if (dirty) {
    return (
      <Tag tone="amber" title="uncommitted changes">
        dirty
      </Tag>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-done" title="working tree clean">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-done" aria-hidden />
      clean
    </span>
  );
}

function AheadBehind({ ahead, behind }: { ahead: number | null; behind: number | null }) {
  if (!ahead && !behind) return null;
  return (
    <span
      className="flex items-center gap-1 text-[10px] tabular-nums text-ink-faint"
      title={`${ahead ?? 0} ahead, ${behind ?? 0} behind upstream`}
    >
      {ahead ? <span>↑{ahead}</span> : null}
      {behind ? <span>↓{behind}</span> : null}
    </span>
  );
}

import type { AgentRecord, Project, WorktreeSlot } from '../../shared/types';
import { SlotCard } from './SlotCard';
import { needsYou, shortPath } from '../lib/format';

export interface SlotEntry {
  slot: WorktreeSlot;
  agent: AgentRecord | null;
}

interface Props {
  project: Project | null;
  slots: SlotEntry[];
  selectedId: string | null;
  idleByAgent: Record<string, number>;
  onSelect: (id: string) => void;
}

/** The per-project view: a header summary + a grid of worktree slot cards. */
export function SlotGrid({ project, slots, selectedId, idleByAgent, onSelect }: Props) {
  if (!project) return null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ProjectHeader project={project} slots={slots} />
      <div className="mc-fade-in grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-6 px-6 pb-8 sm:gap-7 sm:px-8">
        {slots.map(({ slot, agent }) => (
          <SlotCard
            key={slot.path}
            slot={slot}
            agent={agent}
            selected={agent != null && agent.id === selectedId}
            idleSec={agent ? idleByAgent[agent.id] ?? null : null}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectHeader({ project, slots }: { project: Project; slots: SlotEntry[] }) {
  const occupied = slots.filter((s) => s.agent).length;
  const needYou = slots.filter((s) => s.agent && needsYou(s.agent)).length;
  const dirty = slots.filter((s) => s.slot.dirty).length;
  const total = slots.length;

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-6 py-4 sm:px-8">
      <h2 className="text-[15px] font-semibold tracking-tight text-ink">{project.name}</h2>
      <span className="font-mono text-[11px] text-ink-faint" title={project.root}>
        {shortPath(project.root)}
      </span>
      {project.origin === 'manual' && (
        <span className="rounded border border-hairline bg-surface-2 px-1.5 py-px text-[10px] text-ink-faint">added</span>
      )}
      <span className="ml-auto flex items-center gap-2 text-[11px] tabular-nums text-ink-faint">
        <span>
          {total} worktree{total === 1 ? '' : 's'}
        </span>
        <span className="text-ink-faint/50">·</span>
        <span>{occupied} active</span>
        {needYou > 0 && (
          <>
            <span className="text-ink-faint/50">·</span>
            <span className="text-waiting">{needYou} need you</span>
          </>
        )}
        {dirty > 0 && (
          <>
            <span className="text-ink-faint/50">·</span>
            <span>{dirty} dirty</span>
          </>
        )}
      </span>
    </div>
  );
}

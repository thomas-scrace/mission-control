import type { AgentRecord, Project, WorktreeSlot } from '../../shared/types';
import { SlotCard } from './SlotCard';
import { Swimlanes, Lane } from './Swimlanes';
import { agentLane, needsYou, shortPath } from '../lib/format';

export interface SlotEntry {
  slot: WorktreeSlot;
  agent: AgentRecord | null;
  /** "Worktree N" — a stable per-project number; the real dir name is the hover title. */
  label: string;
  labelTitle: string;
}

interface Props {
  project: Project | null;
  slots: SlotEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Manually (un)block a card by dragging it to/from the Blocked lane. */
  onBlock: (id: string, blocked: boolean) => void;
}

/** The per-project view: a header summary + a grid of worktree slot cards. */
export function SlotGrid({ project, slots, selectedId, onSelect, onBlock }: Props) {
  if (!project) return null;

  const cardFor = (e: SlotEntry) => (
    <SlotCard
      key={e.slot.path}
      slot={e.slot}
      agent={e.agent}
      label={e.label}
      labelTitle={e.labelTitle}
      selected={e.agent != null && e.agent.id === selectedId}
      onSelect={onSelect}
    />
  );

  // Manually-blocked first; the rest split into Running / Needs me / Available.
  const blocked = slots.filter((e) => e.agent?.blocked);
  const rest = slots.filter((e) => !e.agent?.blocked);
  const running = rest.filter((e) => e.agent && agentLane(e.agent) === 'running');
  const needsMe = rest.filter((e) => e.agent && agentLane(e.agent) === 'needs-me');
  const available = rest.filter((e) => !e.agent);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ProjectHeader project={project} slots={slots} />
      <Swimlanes>
        <Lane label="Blocked" count={blocked.length} tone="blocked" first onDropCard={(id) => onBlock(id, true)} emptyHint="Drag a card here to park it as blocked.">
          {blocked.map(cardFor)}
        </Lane>
        {running.length > 0 && (
          <Lane label="Running" count={running.length} tone="running" onDropCard={(id) => onBlock(id, false)}>
            {running.map(cardFor)}
          </Lane>
        )}
        {needsMe.length > 0 && (
          <Lane label="Needs me" count={needsMe.length} tone="needs" onDropCard={(id) => onBlock(id, false)}>
            {needsMe.map(cardFor)}
          </Lane>
        )}
        {available.length > 0 && (
          <Lane label="Available" count={available.length} tone="available" onDropCard={(id) => onBlock(id, false)}>
            {available.map(cardFor)}
          </Lane>
        )}
      </Swimlanes>
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

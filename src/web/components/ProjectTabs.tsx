import { useMemo, useState } from 'react';
import type { Project } from '../../shared/types';

export interface ProjectStat {
  occupied: number;
  needYou: number;
  dirty: number;
}

interface Props {
  projects: Project[];
  stats: Record<string, ProjectStat>;
  active: string; // 'all' | projectId
  onSelect: (tab: string) => void;
  onAddProject: (path: string) => Promise<{ ok: boolean; detail: string }>;
}

/**
 * The project tab strip: "All" overview (pinned first) + one tab per project (stable
 * order) with occupied / need-you / dirty pills, plus a "+ Add project" path input.
 * Horizontally scrollable so many projects never break the layout.
 */
export function ProjectTabs({ projects, stats, active, onSelect, onAddProject }: Props) {
  // Stable order — sort once by name then id; never reshuffle on stat changes.
  const ordered = useMemo(
    () => [...projects].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1)),
    [projects],
  );

  return (
    <nav
      role="tablist"
      aria-label="Projects"
      className="z-20 flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-hairline bg-surface/60 px-3 backdrop-blur-md"
    >
      <Tab label="All" active={active === 'all'} onClick={() => onSelect('all')} />
      {ordered.map((p) => (
        <Tab
          key={p.id}
          label={p.name}
          active={active === p.id}
          onClick={() => onSelect(p.id)}
          stat={stats[p.id]}
        />
      ))}
      <AddProject onAddProject={onAddProject} />
    </nav>
  );
}

function Tab({
  label,
  active,
  onClick,
  stat,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  stat?: ProjectStat;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors',
        active ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:text-ink-dim',
      ].join(' ')}
    >
      <span className="max-w-[200px] truncate">{label}</span>
      {stat && stat.occupied > 0 && (
        <span className="tabular-nums text-ink-faint/80" title={`${stat.occupied} active`}>
          {stat.occupied}
        </span>
      )}
      {stat && stat.needYou > 0 && (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-waiting/40 bg-waiting/10 px-1.5 text-[10px] font-semibold tabular-nums text-waiting"
          title={`${stat.needYou} need you`}
        >
          <span className="mc-busy-pulse inline-block h-1 w-1 rounded-full bg-current" aria-hidden />
          {stat.needYou}
        </span>
      )}
      {stat && stat.dirty > 0 && (
        <span className="inline-flex items-center gap-1 text-[10px] tabular-nums text-idle" title={`${stat.dirty} dirty`}>
          <span className="inline-block h-1 w-1 rounded-full bg-current" aria-hidden />
          {stat.dirty}
        </span>
      )}
    </button>
  );
}

function AddProject({ onAddProject }: { onAddProject: Props['onAddProject'] }) {
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const close = () => {
    setAdding(false);
    setPath('');
    setErr(null);
  };

  const submit = async () => {
    if (!path.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await onAddProject(path.trim());
      if (r.ok) close();
      else setErr(r.detail);
    } catch {
      setErr('Could not add project');
    } finally {
      setBusy(false);
    }
  };

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="ml-1 shrink-0 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-ink-faint transition-colors hover:text-ink-dim"
        title="Add a project by repo path"
      >
        + Add project
      </button>
    );
  }

  return (
    <div className="ml-1 flex shrink-0 items-center gap-1.5">
      <input
        autoFocus
        type="text"
        value={path}
        disabled={busy}
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
          else if (e.key === 'Escape') close();
        }}
        placeholder="~/code/my-repo"
        aria-label="Project repo path"
        className="h-7 w-52 rounded-md border border-hairline bg-void/60 px-2 text-[12px] text-ink placeholder:text-ink-faint focus:border-accent/50 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="rounded-md border border-accent/50 bg-accent/10 px-2 py-1 text-[11px] font-semibold text-accent disabled:opacity-60"
      >
        {busy ? 'Adding…' : 'Add'}
      </button>
      <button type="button" onClick={close} className="rounded-md px-1.5 py-1 text-[11px] text-ink-faint hover:text-ink-dim" aria-label="Cancel">
        ✕
      </button>
      {err && <span className="max-w-[200px] truncate text-[11px] text-error" title={err}>{err}</span>}
    </div>
  );
}

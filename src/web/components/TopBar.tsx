import type { Tool } from '../../shared/types';
import type { ConnectionState } from '../sse';
import { ToolMark } from './LogoIcons';

export type ToolFilter = 'all' | Tool;

export interface Filters {
  tool: ToolFilter;
  liveOnly: boolean;
  recent24h: boolean;
  query: string;
}

interface Props {
  filters: Filters;
  onChange: (next: Partial<Filters>) => void;
  total: number;
  needYou: number;
  live: number;
  connection: ConnectionState;
  /** Greyed out when a project tab (not "All") is active — filters only scope the All grid. */
  filtersDisabled?: boolean;
}

export function TopBar({
  filters,
  onChange,
  total,
  needYou,
  live,
  connection,
  filtersDisabled = false,
}: Props) {
  return (
    <header className="z-30 flex h-14 shrink-0 items-center gap-4 border-b border-hairline bg-surface/80 px-4 backdrop-blur-md">
      {/* Wordmark */}
      <div className="flex items-center gap-2.5">
        <span
          className="mc-dot-live inline-block h-2 w-2 rounded-full bg-live"
          aria-hidden
        />
        <span className="text-sm font-semibold tracking-[0.18em] text-ink">
          MISSION CONTROL
        </span>
      </div>

      {/* Live counts */}
      <div className="hidden items-center gap-2 text-xs text-ink-dim sm:flex">
        <span className="text-ink-faint">·</span>
        <span className="tabular-nums">
          <span className="font-medium text-ink">{total}</span> agent
          {total === 1 ? '' : 's'}
        </span>
        {needYou > 0 && (
          <>
            <span className="text-ink-faint">·</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-waiting/40 bg-waiting/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-waiting">
              <span
                className="mc-busy-pulse inline-block h-1.5 w-1.5 rounded-full bg-current"
                aria-hidden
              />
              {needYou} need{needYou === 1 ? 's' : ''} you
            </span>
          </>
        )}
        {live > 0 && (
          <>
            <span className="text-ink-faint">·</span>
            <span className="tabular-nums text-live">{live} live</span>
          </>
        )}
      </div>

      <div className="flex-1" />

      {/* Filters — only scope the All grid, so dim them on a project tab. */}
      <div className="flex items-center gap-2">
        <div
          className={[
            'flex items-center gap-2 transition-opacity',
            filtersDisabled ? 'pointer-events-none opacity-40' : '',
          ].join(' ')}
          aria-hidden={filtersDisabled}
          title={filtersDisabled ? 'Filters apply to the All tab' : undefined}
        >
          <SearchBox
            value={filters.query}
            onChange={(query) => onChange({ query })}
          />

          <ToolToggle
            value={filters.tool}
            onChange={(tool) => onChange({ tool })}
          />

          <FilterChip
            active={filters.liveOnly}
            onClick={() => onChange({ liveOnly: !filters.liveOnly })}
            title="Show only live sessions"
          >
            Live only
          </FilterChip>

          <FilterChip
            active={filters.recent24h}
            onClick={() => onChange({ recent24h: !filters.recent24h })}
            title="Hide sessions inactive for more than 24h"
          >
            24h
          </FilterChip>
        </div>

        <ConnIndicator connection={connection} />
      </div>
    </header>
  );
}

function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint">
        <SearchIcon />
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search summary, job, worktree, branch…"
        aria-label="Search agents"
        className="h-8 w-44 rounded-md border border-hairline bg-void/60 pl-8 pr-2 text-xs text-ink placeholder:text-ink-faint focus:w-56 focus:border-accent/50 focus:outline-none focus:transition-[width] lg:w-56"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-faint hover:text-ink"
        >
          <SmallCloseIcon />
        </button>
      )}
    </div>
  );
}

const TOOL_OPTIONS: { value: ToolFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
];

function ToolToggle({
  value,
  onChange,
}: {
  value: ToolFilter;
  onChange: (v: ToolFilter) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Filter by tool"
      className="flex items-center rounded-md border border-hairline bg-void/60 p-0.5"
    >
      {TOOL_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.label}
            onClick={() => onChange(opt.value)}
            className={[
              'flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors',
              active ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:text-ink-dim',
            ].join(' ')}
          >
            {opt.value !== 'all' && <ToolMark tool={opt.value} size={12} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={[
        'h-8 rounded-md border px-2.5 text-[11px] font-medium transition-colors',
        active
          ? 'border-accent/50 bg-accent/10 text-accent'
          : 'border-hairline bg-void/60 text-ink-faint hover:text-ink-dim',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function ConnIndicator({ connection }: { connection: ConnectionState }) {
  const connected = connection === 'open';
  const label = connected ? 'Connected' : 'Reconnecting…';
  return (
    <span
      className="ml-1 flex items-center gap-1.5"
      title={label}
      aria-label={`SSE ${label}`}
    >
      <span
        className={[
          'inline-block h-2 w-2 rounded-full',
          connected ? 'bg-live mc-dot-live' : 'mc-busy-pulse bg-error',
        ].join(' ')}
      />
      <span className="hidden text-[10px] uppercase tracking-wide text-ink-faint md:inline">
        {connected ? 'LIVE' : 'RECONN'}
      </span>
    </span>
  );
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10.5 10.5L14 14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SmallCloseIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

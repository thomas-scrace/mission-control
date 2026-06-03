import { useEffect, useRef, useState } from 'react';
import type {
  AgentBrief,
  AgentRecord,
  HistoryEntry,
  HistoryKind,
  PullRequest,
} from '../../shared/types';
import { PHASE_LABELS } from '../../shared/types';
import { focusAgent } from '../sse';
import { StatusPill } from './StatusPill';
import { LivenessDot } from './LivenessDot';
import { PhaseStepper } from './PhaseStepper';
import { CiIndicator, PrTags } from './PrStatus';
import { ToolMark } from './LogoIcons';
import {
  clean,
  clockTime,
  contextPct,
  displayJob,
  formatSeconds,
  formatTokens,
  fullDateTime,
  runtimeBadge,
  timeAgo,
} from '../lib/format';

interface Props {
  agent: AgentRecord | null;
  serverTime: number;
  onClose: () => void;
  onMeta: (
    id: string,
    body: {
      pinned?: boolean;
      jobName?: string | null;
      dismissed?: boolean;
      notes?: string | null;
    },
  ) => void;
}

export function DetailDrawer({ agent, serverTime, onClose, onMeta }: Props) {
  // Escape-to-close while a drawer is open.
  useEffect(() => {
    if (!agent) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agent, onClose]);

  if (!agent) return null;

  return (
    <>
      {/* Scrim */}
      <div
        className="mc-fade-in fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label="Agent detail"
        className="mc-drawer fixed inset-y-0 right-0 z-50 flex w-[440px] max-w-[92vw] flex-col border-l border-hairline bg-surface shadow-2xl"
      >
        <DrawerBody
          // Re-mount when switching agents so local input state resets cleanly.
          key={agent.id}
          agent={agent}
          serverTime={serverTime}
          onClose={onClose}
          onMeta={onMeta}
        />
      </aside>
    </>
  );
}

function DrawerBody({ agent, serverTime, onClose, onMeta }: Props & { agent: AgentRecord }) {
  const pct = contextPct(agent.tokens, agent.contextWindow);
  const rawTokens = formatTokens(agent.tokens);
  const model = clean(agent.model);
  const branch = clean(agent.branch);
  const lastMessage = clean(agent.lastMessage);
  const basis = clean(agent.livenessBasis);
  const prLink = clean(agent.prLink);
  const sourceFile = clean(agent.sourceFile);
  const rawTail = clean(agent.rawTail);
  const permissionMode = clean(agent.permissionMode);
  const subagents = agent.subagentsActive ?? 0;
  const idle = agent.idleSec != null ? formatSeconds(agent.idleSec) : null;

  const structuredEmpty =
    !lastMessage && !clean(agent.lastAction) && agent.history.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex items-start gap-3 border-b border-hairline px-5 py-4">
        <div className="min-w-0 flex-1">
          <RenameField agent={agent} onMeta={onMeta} />
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-ink-dim">
            <span className="flex items-center gap-1 rounded-sm bg-hairline px-1.5 py-0.5 text-[10px] font-bold not-italic">
              <ToolMark tool={agent.tool} size={12} />
              {agent.tool === 'claude' ? 'Claude' : 'Codex'}
            </span>
            {runtimeBadge(agent.runtime) && (
              <span className="text-ink-faint uppercase">
                {runtimeBadge(agent.runtime)}
              </span>
            )}
            <span className="truncate text-ink" title={agent.cwd}>
              {clean(agent.worktree) ?? '—'}
            </span>
            {branch && (
              <>
                <span className="text-ink-faint">·</span>
                <span className="truncate text-ink-dim">{branch}</span>
              </>
            )}
            {model && (
              <>
                <span className="text-ink-faint">·</span>
                <span className="truncate text-ink-dim">{model}</span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 shrink-0 rounded p-1 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <CloseIcon />
        </button>
      </header>

      {/* Scrollable content */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {/* Synthesized brief — the human-readable summary, shown first. */}
        {agent.brief && agent.brief.state === 'ready' && (
          <BriefSection brief={agent.brief} />
        )}

        {/* Status + liveness */}
        <section className="space-y-2">
          <div className="flex items-center gap-3">
            <StatusPill status={agent.status} size="md" />
            <span className="flex items-center gap-1.5 text-xs text-ink-dim">
              <LivenessDot
                liveness={agent.liveness}
                basis={agent.livenessBasis}
              />
              <span className="capitalize">{agent.liveness}</span>
            </span>
            <span className="ml-auto text-xs tabular-nums text-ink-faint">
              updated {timeAgo(agent.updatedAt, serverTime)} ago
            </span>
          </div>
          {clean(agent.statusDetail) && (
            <p
              className={[
                'text-xs leading-relaxed',
                agent.status === 'error' ? 'text-error/90' : 'text-ink-dim',
              ].join(' ')}
            >
              {agent.statusDetail}
            </p>
          )}
          {basis && (
            <p className="text-[11px] text-ink-faint">
              <span className="text-ink-faint/70">liveness:</span> {basis}
            </p>
          )}
        </section>

        {/* Context / tokens */}
        {(pct != null || rawTokens != null || subagents > 0 || idle) && (
          <section className="space-y-2">
            <SectionLabel>Resources</SectionLabel>
            {pct != null ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ink-dim">Context</span>
                  <span className="tabular-nums text-ink">
                    {rawTokens}
                    {agent.contextWindow != null && (
                      <span className="text-ink-faint">
                        {' / '}
                        {formatTokens(agent.contextWindow)}
                      </span>
                    )}
                    <span className="ml-2 text-ink-dim">
                      {Math.round(pct)}%
                    </span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-hairline">
                  <div
                    className={`h-full rounded-full ${
                      pct >= 85 ? 'bg-error' : pct >= 65 ? 'bg-waiting' : 'bg-accent'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            ) : (
              rawTokens != null && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-ink-dim">Tokens</span>
                  <span className="tabular-nums text-ink">{rawTokens}</span>
                </div>
              )
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {subagents > 0 && (
                <Badge tone="accent">
                  {subagents} subagent{subagents > 1 ? 's' : ''} running
                </Badge>
              )}
              {idle && <Badge tone="muted">idle {idle}</Badge>}
              {permissionMode && (
                <Badge tone="muted">mode: {permissionMode}</Badge>
              )}
            </div>
          </section>
        )}

        {/* Pull request (structured) */}
        {agent.pr && <PrSection pr={agent.pr} />}

        {/* Last message */}
        {lastMessage && (
          <section className="space-y-2">
            <SectionLabel>Latest message</SectionLabel>
            <p className="rounded-md border border-hairline bg-surface-2 px-3 py-2.5 text-[13px] leading-relaxed text-ink">
              {lastMessage}
            </p>
          </section>
        )}

        {/* History timeline */}
        {agent.history.length > 0 && (
          <section className="space-y-2">
            <SectionLabel>History</SectionLabel>
            <Timeline history={agent.history} serverTime={serverTime} />
          </section>
        )}

        {/* Raw tail fallback */}
        {rawTail && structuredEmpty && (
          <section className="space-y-2">
            <SectionLabel>Raw tail</SectionLabel>
            <pre className="overflow-x-auto rounded-md border border-hairline bg-void px-3 py-2.5 font-mono text-[11px] leading-relaxed text-ink-dim">
              {rawTail}
            </pre>
          </section>
        )}

        {/* PR link (legacy transcript-derived fallback; only when no structured PR) */}
        {!agent.pr && prLink && (
          <section>
            <a
              href={prLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
            >
              <PrIcon />
              <span className="truncate">{prLink}</span>
            </a>
          </section>
        )}

        {/* Notes */}
        <section className="space-y-2">
          <SectionLabel>Notes</SectionLabel>
          <NotesField agent={agent} onMeta={onMeta} />
        </section>

        {/* Source file */}
        {sourceFile && (
          <section>
            <p
              className="truncate font-mono text-[11px] text-ink-faint"
              title={sourceFile}
            >
              {sourceFile}
            </p>
          </section>
        )}
      </div>

      {/* Footer actions */}
      <footer className="flex items-center gap-2 border-t border-hairline px-5 py-3">
        <button
          type="button"
          onClick={() => void focusAgent(agent.id).catch(() => {})}
          title="Open the agent's window"
          className="flex items-center gap-1.5 rounded border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
        >
          Open agent
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M5 11 11 5M6 5h5v5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="ml-auto" />
        <button
          type="button"
          onClick={() => onMeta(agent.id, { pinned: !agent.pinned })}
          className={[
            'flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs transition-colors',
            agent.pinned
              ? 'border-accent/50 bg-accent/10 text-accent'
              : 'border-hairline-bright text-ink-dim hover:border-accent/40 hover:text-ink',
          ].join(' ')}
        >
          {agent.pinned ? 'Unpin' : 'Pin'}
        </button>
        <button
          type="button"
          onClick={() => onMeta(agent.id, { dismissed: !agent.dismissed })}
          title={agent.dismissed ? 'Unhide — return this agent to the board' : 'Hide — tuck this agent behind the Hidden tab'}
          className="flex items-center gap-1.5 rounded border border-hairline-bright px-3 py-1.5 text-xs text-ink-dim transition-colors hover:border-accent/40 hover:text-ink"
        >
          {agent.dismissed ? 'Unhide' : 'Hide'}
        </button>
      </footer>
    </div>
  );
}

/* ── Subcomponents ─────────────────────────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
      {children}
    </h3>
  );
}

/** The full synthesized brief, pinned to the top of the drawer. */
function BriefSection({ brief }: { brief: AgentBrief }) {
  const summary = clean(brief.summary);
  const reason = clean(brief.needsReason);
  const lastAsk = clean(brief.lastAsk);
  const nextStep = clean(brief.nextStep);

  return (
    <section className="space-y-3 rounded-lg border border-hairline bg-surface-2 p-3.5">
      <div className="flex items-center justify-between">
        <SectionLabel>Brief</SectionLabel>
        {brief.phase && (
          <span className="text-[10px] font-medium uppercase tracking-wider text-accent">
            {PHASE_LABELS[brief.phase]}
          </span>
        )}
      </div>

      {summary && (
        <p className="text-[14px] font-medium leading-snug text-ink">{summary}</p>
      )}

      <PhaseStepper phase={brief.phase} />

      {brief.needsYou && (
        <div className="flex items-start gap-2 rounded-md border border-waiting/40 bg-waiting/10 px-2.5 py-2 text-[12px] leading-snug text-waiting">
          <span className="mt-px text-[10px] font-bold uppercase tracking-wider">
            Needs you
          </span>
          {reason && <span className="min-w-0 flex-1">{reason}</span>}
        </div>
      )}

      {lastAsk && (
        <div className="space-y-0.5">
          <span className="text-[9.5px] font-semibold uppercase tracking-wider text-ink-faint">
            You asked
          </span>
          <p className="text-[12.5px] italic leading-snug text-ink-dim">
            {lastAsk}
          </p>
        </div>
      )}

      {nextStep && (
        <div className="space-y-0.5">
          <span className="text-[9.5px] font-semibold uppercase tracking-wider text-ink-faint">
            Next
          </span>
          <p className="text-[12.5px] font-medium leading-snug text-ink">
            {nextStep}
          </p>
        </div>
      )}
    </section>
  );
}

/** Full PR detail: link + title, state badge, base branch, CI, mergeability. */
function PrSection({ pr }: { pr: PullRequest }) {
  const merged = pr.state === 'MERGED';
  const closed = pr.state === 'CLOSED';

  const stateCls = merged
    ? 'border-violet-400/30 bg-violet-400/10 text-violet-300'
    : closed
      ? 'border-hairline bg-surface-2 text-ink-faint'
      : 'border-done/30 bg-done/10 text-done'; // OPEN

  const ci = ciLine(pr);

  return (
    <section className="space-y-2.5">
      <SectionLabel>Pull request</SectionLabel>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${stateCls}`}
        >
          {pr.state || 'OPEN'}
        </span>
        <span className="text-[11px] text-ink-faint">
          → <span className="font-mono text-ink-dim">{pr.baseRef}</span>
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          <PrTags pr={pr} />
        </span>
      </div>

      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        className="block text-[13px] leading-snug text-accent hover:underline"
      >
        <span className="font-medium tabular-nums">PR #{pr.number}</span>
        {clean(pr.title) && <span className="text-ink"> — {pr.title}</span>}
      </a>

      <div className="flex items-center gap-1.5 text-[12px] text-ink-dim">
        <span className="text-ink-faint">CI:</span>
        <CiIndicator
          ci={pr.ci}
          checksTotal={pr.checksTotal}
          checksFailing={pr.checksFailing}
        />
        <span>{ci}</span>
      </div>

      {(pr.conflicts || pr.behindBase || pr.isDraft) && (
        <ul className="space-y-1 text-[12px]">
          {pr.conflicts && (
            <li className="text-error">⚠ merge conflicts</li>
          )}
          {pr.behindBase && (
            <li className="text-waiting">behind {pr.baseRef}</li>
          )}
          {pr.isDraft && <li className="text-ink-faint">draft</li>}
        </ul>
      )}
    </section>
  );
}

/** Human CI summary line, e.g. "failing · 1/9 checks failing". */
function ciLine(pr: PullRequest): string {
  switch (pr.ci) {
    case 'passing':
      return pr.checksTotal > 0
        ? `passing · ${pr.checksTotal} check${pr.checksTotal === 1 ? '' : 's'}`
        : 'passing';
    case 'failing':
      return pr.checksTotal > 0
        ? `failing · ${pr.checksFailing}/${pr.checksTotal} check${pr.checksTotal === 1 ? '' : 's'} failing`
        : 'failing';
    case 'pending':
      return 'pending';
    default:
      return 'no checks';
  }
}

function Badge({
  tone,
  children,
}: {
  tone: 'accent' | 'muted';
  children: React.ReactNode;
}) {
  return (
    <span
      className={[
        'inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium',
        tone === 'accent'
          ? 'bg-accent/15 text-accent'
          : 'bg-hairline text-ink-dim',
      ].join(' ')}
    >
      {children}
    </span>
  );
}

function RenameField({
  agent,
  onMeta,
}: {
  agent: AgentRecord;
  onMeta: Props['onMeta'];
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(agent.jobName ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    const trimmed = value.trim();
    const next = trimmed.length ? trimmed : null;
    // Only persist if changed; sending null clears the override (back to job).
    if (next !== (agent.jobName ?? null)) {
      onMeta(agent.id, { jobName: next });
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setValue(agent.jobName ?? '');
            setEditing(false);
          }
        }}
        placeholder={clean(agent.job) ?? 'Name this session'}
        className="w-full rounded border border-accent/50 bg-void px-2 py-1 text-base font-semibold text-ink outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setValue(agent.jobName ?? '');
        setEditing(true);
      }}
      className="group/title flex w-full items-start gap-1.5 text-left"
      title="Rename"
    >
      <span className="text-base font-semibold leading-snug text-ink">
        {displayJob(agent)}
      </span>
      <span className="mt-1 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover/title:opacity-100">
        <PencilIcon />
      </span>
    </button>
  );
}

function NotesField({
  agent,
  onMeta,
}: {
  agent: AgentRecord;
  onMeta: Props['onMeta'];
}) {
  const [value, setValue] = useState(agent.notes ?? '');
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(agent.notes ?? '');

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const scheduleSave = (next: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const trimmed = next.trim();
      const payload = trimmed.length ? trimmed : null;
      // Only persist when the content actually differs from the last save.
      if ((payload ?? '') !== lastSavedRef.current) {
        onMeta(agent.id, { notes: payload });
        lastSavedRef.current = payload ?? '';
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    }, 700);
  };

  return (
    <div className="space-y-1">
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          scheduleSave(e.target.value);
        }}
        rows={3}
        placeholder="Add a note (autosaves)…"
        className="w-full resize-y rounded-md border border-hairline bg-surface-2 px-3 py-2 text-[13px] leading-relaxed text-ink placeholder:text-ink-faint focus:border-accent/50 focus:outline-none"
      />
      {saved && (
        <span className="text-[10px] uppercase tracking-wide text-done">
          Saved
        </span>
      )}
    </div>
  );
}

const KIND_STYLES: Record<HistoryKind, { dot: string; label: string }> = {
  tool: { dot: 'bg-accent', label: 'tool' },
  message: { dot: 'bg-ink-dim', label: 'message' },
  user: { dot: 'bg-done', label: 'user' },
  pr: { dot: 'bg-fuchsia-400', label: 'pr' },
  system: { dot: 'bg-idle', label: 'system' },
  subagent: { dot: 'bg-waiting', label: 'subagent' },
  compaction: { dot: 'bg-purple-400', label: 'compaction' },
  plan: { dot: 'bg-cyan-300', label: 'plan' },
};

function Timeline({
  history,
  serverTime,
}: {
  history: HistoryEntry[];
  serverTime: number;
}) {
  // Most-recent first.
  const ordered = [...history].sort((a, b) => b.ts - a.ts);
  return (
    <ol className="relative space-y-0">
      {ordered.map((entry, i) => {
        const style = KIND_STYLES[entry.kind] ?? KIND_STYLES.system;
        const last = i === ordered.length - 1;
        return (
          <li key={`${entry.ts}-${i}`} className="relative flex gap-3 pb-3">
            {/* connector line */}
            {!last && (
              <span
                className="absolute left-[3px] top-3 h-full w-px bg-hairline"
                aria-hidden
              />
            )}
            <span
              className={`relative z-10 mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] text-ink" title={entry.label}>
                  {entry.label}
                </span>
                <span
                  className="shrink-0 text-[10px] tabular-nums text-ink-faint"
                  title={fullDateTime(entry.ts)}
                >
                  {timeAgo(entry.ts, serverTime)}
                </span>
              </div>
              <span className="text-[10px] uppercase tracking-wide text-ink-faint">
                {style.label} · {clockTime(entry.ts)}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ── Icons ─────────────────────────────────────────────────────────────── */

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M11.5 1.5a1.5 1.5 0 0 1 2.12 2.12l-8.3 8.3-2.83.71.71-2.83 8.3-8.3Z" />
    </svg>
  );
}

function PrIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4 2.5a1.5 1.5 0 1 0-1 2.83V10.67a1.5 1.5 0 1 0 1 0V5.33A1.5 1.5 0 0 0 4 2.5Zm8 8.17V5a2.5 2.5 0 0 0-2.5-2.5H8.7l1.15-1.15-.7-.7L6.8 3l2.35 2.35.7-.7L8.7 3.5h.8A1.5 1.5 0 0 1 11 5v5.67a1.5 1.5 0 1 0 1 0Z" />
    </svg>
  );
}

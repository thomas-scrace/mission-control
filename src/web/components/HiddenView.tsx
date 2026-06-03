import type { AgentRecord } from '../../shared/types';
import { AgentCard } from './AgentCard';

interface Props {
  agents: AgentRecord[];
  selectedId: string | null;
  idleByAgent: Record<string, number>;
  onSelect: (id: string) => void;
  /** Unhide handler — same signature as Hide; the card flips its label by dismissed state. */
  onHide: (id: string, hidden: boolean) => void;
}

/**
 * The Hidden tab: utility agents the user has tucked away. A plain grid (no lanes,
 * no blocked-drag) of the same cards used on the All tab — each shows an "Unhide"
 * button. These agents are excluded from the All tab, its counts, and synthesis.
 */
export function HiddenView({ agents, selectedId, idleByAgent, onSelect, onHide }: Props) {
  if (agents.length === 0) return <EmptyHidden />;
  return (
    <div className="mc-fade-in min-h-0 flex-1 overflow-y-auto px-6 py-5">
      <p className="mb-4 text-[12px] text-ink-faint">
        {agents.length} hidden agent{agents.length === 1 ? '' : 's'} — kept out of the board. Unhide to bring one back.
      </p>
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(380px,1fr))]">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            selected={agent.id === selectedId}
            idleSec={idleByAgent[agent.id] ?? null}
            onSelect={onSelect}
            onHide={onHide}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyHidden() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-32 text-center">
      <div className="text-2xl">🙈</div>
      <div className="text-sm font-medium text-ink-dim">Nothing hidden</div>
      <p className="max-w-sm text-xs leading-relaxed text-ink-faint">
        Use the <span className="text-ink-dim">Hide</span> button on a card to tuck a utility agent away here. You can unhide it any time.
      </p>
    </div>
  );
}

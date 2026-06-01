import type { AgentRecord } from '../../shared/types';
import { clean, needsReason } from '../lib/format';

/**
 * The two-line exchange shown when a card is WAITING on you (needs-you):
 *  - "You:"   the last thing you typed (the raw last user prompt, or the brief's lastAsk).
 *  - "Agent:" what it's asking / reporting (its last prose, else the synthesized reason).
 * So you can re-acquire the conversation without opening the agent. Used by both the
 * All-tab card and the per-project slot card.
 */
export function WaitingExchange({ agent }: { agent: AgentRecord }) {
  const you = clean(agent.lastUserPrompt) ?? clean(agent.brief?.lastAsk ?? null);
  const them =
    clean(agent.lastMessage) ??
    clean(agent.brief?.needsReason ?? null) ??
    clean(agent.statusDetail) ??
    needsReason(agent);

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-void/40 px-3 py-2">
      {you && (
        <p className="mc-clamp-2 text-[12px] leading-snug text-ink-dim">
          <span className="font-semibold uppercase tracking-wide text-done">You: </span>
          {you}
        </p>
      )}
      <p className="mc-clamp-2 text-[12px] leading-snug text-ink-dim">
        <span className="font-semibold uppercase tracking-wide text-ink-faint">Agent: </span>
        {them}
      </p>
    </div>
  );
}

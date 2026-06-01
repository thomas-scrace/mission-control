import type { Tool } from '../../shared/types';

/**
 * Simple, ORIGINAL geometric marks — not the official Anthropic / OpenAI brand
 * assets. They render in `currentColor`, so the per-tool tint comes from the
 * wrapping element (`text-claude` / `text-codex`). Two clearly distinct shapes
 * so Claude vs Codex is unmistakable at a glance (the old "CC"/"CDX" weren't).
 */

/** Claude: a radiating sunburst / asterisk. */
export function ClaudeLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M8 1.6v12.8M1.6 8h12.8M3.45 3.45l9.1 9.1M12.55 3.45l-9.1 9.1" />
    </svg>
  );
}

/** Codex: a hexagon ring with an inner node (OpenAI-ish hexagonal symmetry). */
export function CodexLogo({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
      <path d="M8 1.5 13.6 4.75v6.5L8 14.5 2.4 11.25v-6.5z" />
      <circle cx="8" cy="8" r="2.2" />
    </svg>
  );
}

/** The tool's tinted logo with an accessible label — the card/drawer/topbar badge. */
export function ToolMark({ tool, size = 14 }: { tool: Tool; size?: number }) {
  const label = tool === 'claude' ? 'Claude Code' : 'Codex';
  return (
    <span
      title={label}
      aria-label={label}
      className={`flex items-center ${tool === 'claude' ? 'text-claude' : 'text-codex'}`}
    >
      {tool === 'claude' ? <ClaudeLogo size={size} /> : <CodexLogo size={size} />}
    </span>
  );
}

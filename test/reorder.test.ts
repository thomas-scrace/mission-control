import { describe, it, expect } from 'vitest';
import { reorderOrder } from '../src/web/lib/format';
import type { AgentRecord } from '../src/shared/types';

// reorderOrder only reads id + order.
const mk = (id: string, order: number) => ({ id, order } as AgentRecord);
const list = [mk('A', 0), mk('B', 1000), mk('C', 2000), mk('D', 3000)];

describe('reorderOrder', () => {
  // Cards.tsx passes targetIndex = (edge==='before' ? idx : idx+1) where idx is the
  // target card's index in the FULL visible list (which still contains the dragged card).
  it('dropping a card DOWNWARD lands it just before the target (no off-by-one)', () => {
    // Drag A so it drops "before C": targetIndex = index of C in the full list = 2.
    const o = reorderOrder(list, 'A', 2)!;
    expect(o).toBeGreaterThan(1000); // after B …
    expect(o).toBeLessThan(2000); // … and before C
  });

  it('dropping a card UPWARD lands it just before the target', () => {
    // Drag D so it drops "before B": targetIndex = index of B = 1.
    const o = reorderOrder(list, 'D', 1)!;
    expect(o).toBeGreaterThan(0); // after A …
    expect(o).toBeLessThan(1000); // … and before B
  });

  it('dropping at the very end steps past the last card', () => {
    const o = reorderOrder(list, 'A', 4)!;
    expect(o).toBeGreaterThan(3000);
  });
});

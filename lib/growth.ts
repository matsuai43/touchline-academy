import type { Player, State, Stat } from './game.ts';

// A player's potential and the school's facilities set the limit for core abilities.
// Existing saves may contain abilities above this limit; they are preserved and simply
// stop gaining until the facilities improve enough to raise the limit.
export function statCeiling(s: State, p: Player): number {
  return Math.min(99, 55 + (p.talent - 1) * 20 + (s.facilities - 1) * (3 + (p.talent - 1) * 4));
}

export function applyStatGrowth(s: State, p: Player, k: Stat, amount: number): number {
  const before = p.stats[k];
  const remaining = statCeiling(s, p) - before;
  if (remaining <= 0 || amount <= 0) return 0;
  const tapered = amount * Math.min(1, remaining / 12);
  p.stats[k] = Math.min(99, before + Math.min(remaining, tapered));
  return p.stats[k] - before;
}

import type { Candle } from '../App';

export interface KeyLevel {
  id: string;
  price: number;
  type: 'resistance' | 'support';
  strength: number; // 1-5 (number of tests)
  fibAligned: boolean; // true if within 0.15% of a Fibonacci level
  label: string;
}

interface FibGrid {
  fib000: number;
  fib236: number;
  fib382: number;
  fib500: number;
  fib618: number;
  fib786: number;
  fib100: number;
}

function buildFibGrid(candles: Candle[]): FibGrid | null {
  if (candles.length < 10) return null;
  let highest = candles[0];
  let lowest = candles[0];
  for (const c of candles) {
    if (c.high > highest.high) highest = c;
    if (c.low < lowest.low) lowest = c;
  }
  const H = highest.high;
  const L = lowest.low;
  const diff = H - L;
  if (diff <= 0) return null;
  return {
    fib000: L,
    fib236: L + diff * 0.236,
    fib382: L + diff * 0.382,
    fib500: L + diff * 0.500,
    fib618: L + diff * 0.618,
    fib786: L + diff * 0.786,
    fib100: H,
  };
}

function isFibAligned(price: number, fib: FibGrid, tolerance: number): boolean {
  const levels = [fib.fib000, fib.fib236, fib.fib382, fib.fib500, fib.fib618, fib.fib786, fib.fib100];
  return levels.some((lvl) => Math.abs(price - lvl) / price <= tolerance);
}

/**
 * Detects historically significant horizontal key levels from candle data.
 *
 * Algorithm:
 *  1. Collect all swing highs & swing lows with a larger window (3-5 bars) for stronger significance.
 *  2. Cluster neighbouring price points within a tight band (~0.10-0.15%).
 *  3. Clusters with >= 2 distinct touches across time form a Key Level.
 *  4. Tag levels that overlap with Fibonacci grid levels (confirmation).
 *  5. Returns at most 6 clean, non-overlapping levels sorted by strength.
 */
export function detectKeyLevels(candles: Candle[], timeframeSeconds: number): KeyLevel[] {
  if (candles.length < 30) return [];

  // Use larger swing window for higher significance (avoid noise)
  const swingWindow = timeframeSeconds >= 3600 ? 4 : 3;
  const midPrice = (Math.max(...candles.map((c) => c.high)) + Math.min(...candles.map((c) => c.low))) / 2;

  // Cluster tolerance: 0.12% of price
  const clusterTol = midPrice * 0.0012;
  // Minimum bar separation between touches of the same level
  const minBarSep = swingWindow + 2;

  const swingHighs: { index: number; price: number }[] = [];
  const swingLows: { index: number; price: number }[] = [];

  for (let i = swingWindow; i < candles.length - swingWindow; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;

    for (let j = i - swingWindow; j <= i + swingWindow; j++) {
      if (j === i) continue;
      if (candles[j].high >= c.high) isHigh = false;
      if (candles[j].low <= c.low) isLow = false;
    }

    if (isHigh) swingHighs.push({ index: i, price: c.high });
    if (isLow) swingLows.push({ index: i, price: c.low });
  }

  // Build Fibonacci grid for alignment tagging
  const fibGrid = buildFibGrid(candles);

  const levels: KeyLevel[] = [];

  // Helper to cluster & build levels from swing points
  const processSwings = (
    swings: { index: number; price: number }[],
    type: 'resistance' | 'support'
  ) => {
    const used = new Set<number>();

    for (let i = 0; i < swings.length; i++) {
      if (used.has(i)) continue;

      const seed = swings[i];
      const group: { index: number; price: number }[] = [seed];

      // Collect nearby swings that are both price-close AND time-separated
      for (let j = 0; j < swings.length; j++) {
        if (j === i || used.has(j)) continue;
        if (Math.abs(swings[j].price - seed.price) > clusterTol) continue;

        // Ensure this touch is temporally distinct from all touches already in group
        const distinct = group.every((g) => Math.abs(g.index - swings[j].index) >= minBarSep);
        if (distinct) group.push(swings[j]);
      }

      if (group.length < 2) continue; // Must have at least 2 distinct touches

      // Mark all members as used
      group.forEach((g) => used.add(swings.indexOf(g)));

      const avgPrice = group.reduce((s, g) => s + g.price, 0) / group.length;

      // Check Fibonacci alignment
      const fibAligned = fibGrid ? isFibAligned(avgPrice, fibGrid, 0.0015) : false;

      const strength = Math.min(5, group.length);
      const fibTag = fibAligned ? ' · Fib' : '';
      const label = `${type === 'resistance' ? 'R' : 'S'}${strength}${fibTag}`;

      levels.push({
        id: `kl_${type}_${Math.round(avgPrice * 100000)}`,
        price: avgPrice,
        type,
        strength,
        fibAligned,
        label,
      });
    }
  };

  processSwings(swingHighs, 'resistance');
  processSwings(swingLows, 'support');

  // Remove duplicate / overlapping levels (within 0.20% of each other)
  const dedupTol = midPrice * 0.0020;
  const deduped: KeyLevel[] = [];
  for (const lvl of levels) {
    const hasDup = deduped.some((d) => Math.abs(d.price - lvl.price) < dedupTol);
    if (!hasDup) deduped.push(lvl);
  }

  // Sort by strength desc, then Fib-aligned first
  deduped.sort((a, b) => {
    if (b.strength !== a.strength) return b.strength - a.strength;
    return (b.fibAligned ? 1 : 0) - (a.fibAligned ? 1 : 0);
  });

  // Return at most 6 key levels
  return deduped.slice(0, 6);
}

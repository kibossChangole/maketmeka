import type { Candle } from '../App';
import type { FairValueGap, ImpulseLeg } from './types';

/**
 * Detects 3-candle Fair Value Gaps (imbalances):
 * - Bullish FVG: Candle 3 Low > Candle 1 High (gap between Candle 1 High and Candle 3 Low)
 * - Bearish FVG: Candle 3 High < Candle 1 Low (gap between Candle 3 High and Candle 1 Low)
 * Also tracks if subsequent price action has mitigated/filled the gap.
 */
export function detectFairValueGaps(candles: Candle[], minGapPercent = 0.0003): FairValueGap[] {
  const fvgs: FairValueGap[] = [];
  if (candles.length < 5) return fvgs;

  for (let i = 2; i < candles.length - 1; i++) {
    const c1 = candles[i - 2];
    const c2 = candles[i - 1]; // the expansion candle
    const c3 = candles[i];

    // Bullish FVG
    if (c3.low > c1.high) {
      const top = c3.low;
      const bottom = c1.high;
      const gap = top - bottom;
      if (gap >= c2.close * minGapPercent) {
        // Check mitigation in subsequent candles
        let mitigated = false;
        let mitigationTime: number | undefined;

        for (let j = i + 1; j < candles.length; j++) {
          if (candles[j].low <= top) {
            mitigated = true;
            mitigationTime = Number(candles[j].time);
            break;
          }
        }

        fvgs.push({
          id: `fvg_bull_${c2.time}`,
          type: 'bullish',
          top,
          bottom,
          startTime: Number(c2.time),
          mitigated,
          mitigationTime,
        });
      }
    }

    // Bearish FVG
    if (c3.high < c1.low) {
      const top = c1.low;
      const bottom = c3.high;
      const gap = top - bottom;
      if (gap >= c2.close * minGapPercent) {
        let mitigated = false;
        let mitigationTime: number | undefined;

        for (let j = i + 1; j < candles.length; j++) {
          if (candles[j].high >= bottom) {
            mitigated = true;
            mitigationTime = Number(candles[j].time);
            break;
          }
        }

        fvgs.push({
          id: `fvg_bear_${c2.time}`,
          type: 'bearish',
          top,
          bottom,
          startTime: Number(c2.time),
          mitigated,
          mitigationTime,
        });
      }
    }
  }

  return fvgs;
}

/**
 * Identifies the most recent significant impulse leg and calculates standard Fibonacci levels.
 */
export function detectImpulseLeg(candles: Candle[]): ImpulseLeg | null {
  if (candles.length < 25) return null;

  // Look across recent 30-60 bars for a dominant swing
  const recent = candles.slice(-50);
  let highest = recent[0];
  let lowest = recent[0];

  for (const c of recent) {
    if (c.high > highest.high) highest = c;
    if (c.low < lowest.low) lowest = c;
  }

  const highTime = Number(highest.time);
  const lowTime = Number(lowest.time);

  if (Math.abs(highTime - lowTime) < 1) return null;

  const isBullish = highTime > lowTime;
  const startPrice = isBullish ? lowest.low : highest.high;
  const endPrice = isBullish ? highest.high : lowest.low;
  const startTime = isBullish ? lowTime : highTime;
  const endTime = isBullish ? highTime : lowTime;

  const diff = endPrice - startPrice;

  return {
    startTime,
    endTime,
    startPrice,
    endPrice,
    direction: isBullish ? 'bullish' : 'bearish',
    fib382: startPrice + diff * (1 - 0.382),
    fib500: startPrice + diff * (1 - 0.500),
    fib618: startPrice + diff * (1 - 0.618),
    fib786: startPrice + diff * (1 - 0.786),
  };
}

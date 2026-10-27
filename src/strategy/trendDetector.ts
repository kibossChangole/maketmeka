import type { Candle } from '../App';

export interface TrendSwing {
  time: number;
  price: number;
  type: 'HH' | 'HL' | 'LH' | 'LL';
}

export interface FibZone {
  level: number;   // ratio 0-1
  price: number;
  label: string;   // e.g. '38.2%'
  color: string;
}

export interface TrendOverlay {
  direction: 'bullish' | 'bearish';
  /** Swing points forming the structural sequence (HH/HL or LH/LL) */
  swings: TrendSwing[];
  /** The two defining trendline anchor points (e.g. HL-to-HL for bullish) */
  trendlineP1: { time: number; price: number };
  trendlineP2: { time: number; price: number };
  /** Current impulse swing high/low for Fibonacci */
  impulseHigh: number;
  impulseLow: number;
  /** Fibonacci continuation zones (38.2, 50, 61.8 are key retracement areas) */
  fibZones: FibZone[];
  /** Projected continuation price after ideal retracement */
  continuationTarget: number;
}

const FIB_CONTINUATION: { ratio: number; label: string; color: string }[] = [
  { ratio: 0.236, label: '23.6%', color: 'rgba(148,163,184,0.6)' },
  { ratio: 0.382, label: '38.2%', color: 'rgba(251,191,36,0.7)' },
  { ratio: 0.500, label: '50.0%', color: 'rgba(56,189,248,0.7)' },
  { ratio: 0.618, label: '61.8%', color: 'rgba(52,211,153,0.85)' },
  { ratio: 0.786, label: '78.6%', color: 'rgba(167,139,250,0.7)' },
];

/**
 * Extracts raw swing highs and lows using a pivot window.
 */
function findSwings(
  candles: Candle[],
  window: number
): { highs: { index: number; price: number; time: number }[]; lows: { index: number; price: number; time: number }[] } {
  const highs: { index: number; price: number; time: number }[] = [];
  const lows: { index: number; price: number; time: number }[] = [];

  for (let i = window; i < candles.length - window; i++) {
    let isHigh = true;
    let isLow = true;

    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }

    if (isHigh) highs.push({ index: i, price: candles[i].high, time: Number(candles[i].time) });
    if (isLow) lows.push({ index: i, price: candles[i].low, time: Number(candles[i].time) });
  }

  return { highs, lows };
}

/**
 * After a confirmed breakout, detects the active trend structure and computes
 * Fibonacci retracement zones for trend continuation targeting.
 *
 * Bullish: looks for Higher Highs (HH) and Higher Lows (HL)
 * Bearish: looks for Lower Highs (LH) and Lower Lows (LL)
 */
export function detectTrendOverlay(
  candles: Candle[],
  timeframeSeconds: number,
  direction: 'bullish' | 'bearish'
): TrendOverlay | null {
  if (candles.length < 40) return null;

  // Swing window grows with timeframe to avoid noise
  const swingWindow = timeframeSeconds >= 14400 ? 5 : timeframeSeconds >= 3600 ? 4 : 3;

  // Limit lookback: use last N candles relevant to the timeframe
  const lookbackCandleMap: Record<number, number> = {
    60: 180,    // 1m: 3h
    300: 144,   // 5m: 12h
    900: 96,    // 15m: 24h
    1800: 72,   // 30m: 36h
    3600: 60,   // 1h: 60h
    7200: 50,   // 2h: 100h
    14400: 40,  // 4h: 160h
  };
  const maxLookback = lookbackCandleMap[timeframeSeconds] ?? 96;
  const slice = candles.slice(-maxLookback);

  const { highs, lows } = findSwings(slice, swingWindow);

  if (direction === 'bullish') {
    // Identify the last 3+ swing highs forming HH sequence and swing lows forming HL sequence
    const recentHighs = highs.slice(-4);
    const recentLows = lows.slice(-4);

    if (recentHighs.length < 2 || recentLows.length < 2) return null;

    // Verify HH structure (each high > prior high)
    let hasHH = false;
    for (let i = 1; i < recentHighs.length; i++) {
      if (recentHighs[i].price > recentHighs[i - 1].price) { hasHH = true; break; }
    }
    // Verify HL structure (each low > prior low)
    let hasHL = false;
    for (let i = 1; i < recentLows.length; i++) {
      if (recentLows[i].price > recentLows[i - 1].price) { hasHL = true; break; }
    }

    if (!hasHH || !hasHL) return null;

    // Trendline anchors: connect the two most recent Higher Lows
    const hl1 = recentLows[recentLows.length - 2];
    const hl2 = recentLows[recentLows.length - 1];

    // Impulse leg: from most recent HL to most recent HH
    const lastHH = recentHighs[recentHighs.length - 1];
    const impulseHigh = lastHH.price;
    const impulseLow = hl2.price;
    const diff = impulseHigh - impulseLow;

    // Build trend swings list for dot rendering
    const swings: TrendSwing[] = [
      ...recentHighs.map((h, i) => ({
        time: h.time,
        price: h.price,
        type: i === 0 ? 'HH' : recentHighs[i].price > recentHighs[i - 1].price ? 'HH' : 'HH',
      } as TrendSwing)),
      ...recentLows.map((l, i) => ({
        time: l.time,
        price: l.price,
        type: i === 0 ? 'HL' : recentLows[i].price > recentLows[i - 1].price ? 'HL' : 'HL',
      } as TrendSwing)),
    ].sort((a, b) => a.time - b.time);

    const fibZones: FibZone[] = FIB_CONTINUATION.map((f) => ({
      level: f.ratio,
      price: impulseHigh - diff * f.ratio, // retracement back from high
      label: f.label,
      color: f.color,
    }));

    // 1.618 extension target for continuation
    const continuationTarget = impulseHigh + diff * 0.618;

    return {
      direction: 'bullish',
      swings,
      trendlineP1: { time: hl1.time, price: hl1.price },
      trendlineP2: { time: hl2.time, price: hl2.price },
      impulseHigh,
      impulseLow,
      fibZones,
      continuationTarget,
    };
  } else {
    // Bearish: LH + LL
    const recentHighs = highs.slice(-4);
    const recentLows = lows.slice(-4);

    if (recentHighs.length < 2 || recentLows.length < 2) return null;

    let hasLH = false;
    for (let i = 1; i < recentHighs.length; i++) {
      if (recentHighs[i].price < recentHighs[i - 1].price) { hasLH = true; break; }
    }
    let hasLL = false;
    for (let i = 1; i < recentLows.length; i++) {
      if (recentLows[i].price < recentLows[i - 1].price) { hasLL = true; break; }
    }

    if (!hasLH || !hasLL) return null;

    // Trendline anchors: connect the two most recent Lower Highs
    const lh1 = recentHighs[recentHighs.length - 2];
    const lh2 = recentHighs[recentHighs.length - 1];

    // Impulse leg: from most recent LH down to most recent LL
    const lastLL = recentLows[recentLows.length - 1];
    const impulseHigh = lh2.price;
    const impulseLow = lastLL.price;
    const diff = impulseHigh - impulseLow;

    const swings: TrendSwing[] = [
      ...recentHighs.map((h, i) => ({
        time: h.time,
        price: h.price,
        type: i === 0 ? 'LH' : 'LH',
      } as TrendSwing)),
      ...recentLows.map((l, i) => ({
        time: l.time,
        price: l.price,
        type: i === 0 ? 'LL' : 'LL',
      } as TrendSwing)),
    ].sort((a, b) => a.time - b.time);

    const fibZones: FibZone[] = FIB_CONTINUATION.map((f) => ({
      level: f.ratio,
      price: impulseLow + diff * f.ratio, // retracement back up from low
      label: f.label,
      color: f.color,
    }));

    const continuationTarget = impulseLow - diff * 0.618;

    return {
      direction: 'bearish',
      swings,
      trendlineP1: { time: lh1.time, price: lh1.price },
      trendlineP2: { time: lh2.time, price: lh2.price },
      impulseHigh,
      impulseLow,
      fibZones,
      continuationTarget,
    };
  }
}

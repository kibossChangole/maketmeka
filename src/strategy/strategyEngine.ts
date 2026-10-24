import type { Candle } from '../App';
import type { DrawingItem } from '../drawings/types';
import { detectRanges } from './rangeDetector';
import { detectFairValueGaps, detectImpulseLeg } from './fvgDetector';
import { detectKeyLevels } from './keyLevelDetector';
import type { StrategyAnalysisResult, DetectedRange } from './types';

/**
 * Converts detected ranges into visual DrawingItems (rectangles)
 * with color coding reflecting breakout confirmation states.
 */
export function rangeToDrawingItem(range: DetectedRange): DrawingItem {
  let color = '#f59e0b'; // Default amber for range-bound
  let label = `RANGE (${range.candleCount} bars · ${range.heightPips} pips)`;

  if (range.breakoutState === 'bullish_confirmed') {
    color = '#22c98a'; // Green
    label = `BULLISH BREAKOUT CONFIRMED (${range.consecutiveCloses}/${range.requiredCloses} closes)`;
  } else if (range.breakoutState === 'bearish_confirmed') {
    color = '#f43f5e'; // Red
    label = `BEARISH BREAKOUT CONFIRMED (${range.consecutiveCloses}/${range.requiredCloses} closes)`;
  } else if (range.breakoutState === 'bullish_pending') {
    color = '#38bdf8'; // Sky blue
    label = `BULLISH BREAKOUT PENDING (${range.consecutiveCloses}/${range.requiredCloses} closes)`;
  } else if (range.breakoutState === 'bearish_pending') {
    color = '#38bdf8'; // Sky blue
    label = `BEARISH BREAKOUT PENDING (${range.consecutiveCloses}/${range.requiredCloses} closes)`;
  }

  return {
    id: `auto_range_${range.id}`,
    type: 'rectangle',
    p1: { time: range.startTime, price: range.upperBoundary },
    p2: { time: range.endTime, price: range.lowerBoundary },
    color,
    label,
  };
}

export function keyLevelToDrawingItem(
  level: import('./keyLevelDetector').KeyLevel,
  firstTime: number,
  lastTime: number,
  precision = 5
): DrawingItem {
  // Simple dotted line that isn't too distracting
  const color = level.type === 'resistance' ? '#f43f5e' : '#10b981';
  const fibTag = level.fibAligned ? ' · Fib' : '';
  const typeTag = level.type === 'resistance' ? 'Rev Res' : 'Rev Sup';

  return {
    id: `auto_keylevel_${level.id}`,
    type: 'keyLevel',
    p1: { time: firstTime, price: level.price },
    p2: { time: lastTime, price: level.price },
    color,
    label: `${typeTag} ${level.price.toFixed(precision)}${fibTag}`,
  };
}

/**
 * Analyzes market data for a single chart pane according to Strategy A and Strategy B.
 * Also computes key horizontal levels for higher-timeframe reversal context.
 */
export function analyzeChartMarket(
  symbol: string,
  timeframeLabel: string,
  timeframeSeconds: number,
  candles: Candle[],
  precision = 5
): StrategyAnalysisResult {
  const now = Math.floor(Date.now() / 1000);

  if (candles.length < 20) {
    return {
      symbol,
      timeframeLabel,
      timeframeSeconds,
      evaluatedAt: now,
      lookbackCandles: candles.length,
      detectedRanges: [],
      primaryRange: null,
      activeImpulse: null,
      unmitigatedFVGs: [],
      keyLevels: [],
      suggestedDrawings: [],
      statusMessage: 'Insufficient candle data loaded for analysis (minimum 20 required).',
    };
  }

  // Strategy B: Detect structural ranges with 3-close breakout confirmation
  const ranges = detectRanges(candles, timeframeSeconds, precision, 3);
  const primaryRange = ranges.length > 0 ? ranges[0] : null;

  // Strategy A: FVGs and Impulse/Fibonacci
  const allFVGs = detectFairValueGaps(candles);
  const unmitigatedFVGs = allFVGs.filter((f) => !f.mitigated).slice(-4);
  const activeImpulse = detectImpulseLeg(candles);

  // Key Levels: historically significant horizontal reversal zones (averages of highs/lows)
  // Mostly derived and prominent on higher timeframes (1h, 2h, 4h) with Fibonacci confirmation
  const keyLevels = detectKeyLevels(candles, timeframeSeconds);

  // Generate suggested drawings
  const suggestedDrawings: DrawingItem[] = [];
  if (primaryRange) {
    suggestedDrawings.push(rangeToDrawingItem(primaryRange));
  }

  // Potential reversal points: mostly derived on higher timeframes (1h, 2h, 4h)
  const isHTF = timeframeSeconds >= 3600;
  const maxLevelsToPlot = isHTF ? 4 : 2;

  // Prioritize Fibonacci-confirmed levels
  const relevantLevels = keyLevels
    .filter((lvl) => isHTF || lvl.fibAligned)
    .slice(0, maxLevelsToPlot);

  if (relevantLevels.length > 0 && candles.length > 0) {
    const firstTime = Number(candles[0].time);
    const lastTime = Number(candles[candles.length - 1].time);
    for (const kl of relevantLevels) {
      suggestedDrawings.push(keyLevelToDrawingItem(kl, firstTime, lastTime, precision));
    }
  }

  let statusMessage = '';
  if (primaryRange) {
    statusMessage = primaryRange.summary;
  } else {
    statusMessage = `No sustained consolidation range detected within current ${timeframeLabel} lookback window. Market is trending or non-constrained.`;
  }

  return {
    symbol,
    timeframeLabel,
    timeframeSeconds,
    evaluatedAt: now,
    lookbackCandles: candles.length,
    detectedRanges: ranges,
    primaryRange,
    activeImpulse,
    unmitigatedFVGs,
    keyLevels,
    suggestedDrawings,
    statusMessage,
  };
}

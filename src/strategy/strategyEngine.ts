import type { Candle } from '../App';
import type { DrawingItem } from '../drawings/types';
import { detectRanges } from './rangeDetector';
import { detectFairValueGaps, detectImpulseLeg } from './fvgDetector';
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

/**
 * Analyzes market data for a single chart pane according to Strategy A and Strategy B.
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

  // Generate suggested drawings (range rectangles)
  // Only plot the primary active range to keep the chart clean, crisp, and focused
  const suggestedDrawings: DrawingItem[] = [];
  if (primaryRange) {
    suggestedDrawings.push(rangeToDrawingItem(primaryRange));
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
    suggestedDrawings,
    statusMessage,
  };
}

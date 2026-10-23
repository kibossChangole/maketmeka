import type { Candle } from '../App';
import type { BreakoutState, DetectedRange, SwingPoint } from './types';

/**
 * Timeframe-to-lookback matrix in seconds.
 * 1m: 6 hours (360 bars)
 * 5m: 24 hours / 1 day (288 bars) -> strictly within 1 day as requested
 * 15m: 3 days (288 bars)
 * 30m: 5 days (240 bars)
 * 1h: 14 days (336 bars)
 */
export function getMaxLookbackSeconds(timeframeSeconds: number): number {
  if (timeframeSeconds <= 60) return 6 * 3600; // 6 hours
  if (timeframeSeconds <= 300) return 24 * 3600; // 24 hours (1 day)
  if (timeframeSeconds <= 900) return 3 * 24 * 3600; // 3 days
  if (timeframeSeconds <= 1800) return 5 * 24 * 3600; // 5 days
  return 14 * 24 * 3600; // 14 days
}

export function getMinRangeCandles(timeframeSeconds: number): number {
  if (timeframeSeconds <= 60) return 15; // ~15 mins (avoids tiny 2cm ranges)
  if (timeframeSeconds <= 300) return 14; // ~70 mins
  if (timeframeSeconds <= 900) return 12; // ~3 hours
  return 10;
}

export function getMaxRangeCandles(timeframeSeconds: number): number {
  if (timeframeSeconds <= 60) return 35; // ~35 mins (prevents vast sprawling boxes)
  if (timeframeSeconds <= 300) return 32; // ~2.5 hours on 5m
  if (timeframeSeconds <= 900) return 28; // ~7 hours
  return 24;
}

/**
 * Identifies local swing highs and swing lows across a candle sequence.
 */
function findSwingPoints(candles: Candle[], windowSize = 2): SwingPoint[] {
  const points: SwingPoint[] = [];

  for (let i = windowSize; i < candles.length - windowSize; i++) {
    const current = candles[i];
    let isHigh = true;
    let isLow = true;

    for (let j = i - windowSize; j <= i + windowSize; j++) {
      if (j === i) continue;
      if (candles[j].high >= current.high) isHigh = false;
      if (candles[j].low <= current.low) isLow = false;
    }

    if (isHigh) {
      points.push({
        index: i,
        time: Number(current.time),
        price: current.high,
        type: 'high',
      });
    } else if (isLow) {
      points.push({
        index: i,
        time: Number(current.time),
        price: current.low,
        type: 'low',
      });
    }
  }

  return points;
}

interface PriceCluster {
  points: SwingPoint[];
  avgPrice: number;
  maxPrice: number;
  minPrice: number;
  spread: number;
}

/**
 * Finds dense clusters of swing points that are genuinely close to each other in price
 * and separated in time (at least 2 bars apart so they represent distinct touches/tests).
 * A cluster requires at least 2 distinct points within maxSpread of each other.
 */
function findDenseClusters(
  swings: SwingPoint[],
  maxSpread: number,
  minPoints = 2,
  minBarSeparation = 2
): PriceCluster[] {
  const clusters: PriceCluster[] = [];

  for (let i = 0; i < swings.length; i++) {
    const seed = swings[i];
    // Find all other swings whose price is close to the seed
    const matching = swings.filter(
      (s) => Math.abs(s.price - seed.price) <= maxSpread
    );

    // Filter to ensure distinct touches separated in time
    const distinct: SwingPoint[] = [];
    matching.sort((a, b) => a.index - b.index);

    for (const pt of matching) {
      if (distinct.length === 0) {
        distinct.push(pt);
      } else {
        const last = distinct[distinct.length - 1];
        if (pt.index - last.index >= minBarSeparation) {
          distinct.push(pt);
        }
      }
    }

    if (distinct.length >= minPoints) {
      const prices = distinct.map((p) => p.price);
      const maxPrice = Math.max(...prices);
      const minPrice = Math.min(...prices);
      const spread = maxPrice - minPrice;

      // The spread across all clustered points must strictly not exceed maxSpread
      if (spread <= maxSpread) {
        const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;

        // Deduplicate similar clusters
        const exists = clusters.some(
          (c) =>
            Math.abs(c.avgPrice - avgPrice) <= maxSpread * 0.5 &&
            c.points.length === distinct.length
        );

        if (!exists) {
          clusters.push({
            points: distinct,
            avgPrice,
            maxPrice,
            minPrice,
            spread,
          });
        }
      }
    }
  }

  // Sort by touch count descending (more touches = stronger boundary), then tightest spread
  return clusters.sort(
    (a, b) => b.points.length - a.points.length || a.spread - b.spread
  );
}

/**
 * Calculates the linear regression slope of closing prices to test for sideways flatness.
 */
function calculateCloseSlope(candles: Candle[]): number {
  const n = candles.length;
  if (n < 2) return 0;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    const y = candles[i].close;
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumXX += i * i;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

interface ScoredCandidate {
  range: DetectedRange;
  score: number;
}

/**
 * Detects structural consolidation ranges with multi-point averaged boundaries.
 * Strictly requires multiple high points close to each other (average = upper boundary)
 * and multiple low points close to each other (average = lower boundary).
 * Rejects isolated spikes or single high/low outliers.
 */
export function detectRanges(
  allCandles: Candle[],
  timeframeSeconds: number,
  precision = 5,
  requiredCloses = 3
): DetectedRange[] {
  if (allCandles.length < 20) return [];

  // Exclude active (forming) candle to test strictly completed candles
  const completedCandles = allCandles.slice(0, -1);
  if (completedCandles.length < 20) return [];

  const lastCandleTime = Number(completedCandles[completedCandles.length - 1].time);
  const maxLookback = getMaxLookbackSeconds(timeframeSeconds);
  const minAllowedTime = lastCandleTime - maxLookback;

  // Filter candles within the timeframe lookback window
  const startIndex = completedCandles.findIndex((c) => Number(c.time) >= minAllowedTime);
  const lookbackCandles = startIndex >= 0 ? completedCandles.slice(startIndex) : completedCandles;

  if (lookbackCandles.length < 20) return [];

  const minRangeBars = getMinRangeCandles(timeframeSeconds);
  const maxRangeBars = getMaxRangeCandles(timeframeSeconds);
  const swingPoints = findSwingPoints(lookbackCandles, 2);

  const candidates: ScoredCandidate[] = [];

  // Slide candidate windows from newest backwards
  for (let end = lookbackCandles.length - 1; end >= minRangeBars; end -= 2) {
    for (let len = minRangeBars; len <= maxRangeBars && end - len >= 0; len += 3) {
      const start = end - len;
      const windowCandles = lookbackCandles.slice(start, end + 1);

      const windowSwings = swingPoints.filter(
        (sp) => sp.index >= start && sp.index <= end
      );

      const highs = windowSwings.filter((sp) => sp.type === 'high');
      const lows = windowSwings.filter((sp) => sp.type === 'low');

      // Requirement: At least 2 swing highs and at least 2 swing lows
      if (highs.length < 2 || lows.length < 2) continue;

      const windowMidPrice =
        (Math.max(...highs.map((h) => h.price)) + Math.min(...lows.map((l) => l.price))) / 2;

      // Cluster tolerance: maximum price difference between the multiple points
      // In Forex: ~4-6 pips on 1m/5m, ~8 pips on 15m
      const maxClusterSpread =
        timeframeSeconds <= 60
          ? windowMidPrice * 0.00045 // ~4-5 pips
          : timeframeSeconds <= 300
          ? windowMidPrice * 0.00060 // ~6 pips
          : windowMidPrice * 0.00090; // ~9 pips

      // Find clusters of multiple high points close to each other
      const highClusters = findDenseClusters(highs, maxClusterSpread, 2, 2);
      // Find clusters of multiple low points close to each other
      const lowClusters = findDenseClusters(lows, maxClusterSpread, 2, 2);

      // If either ceiling or floor lacks multiple points close to each other, REJECT!
      // This prevents single high points or single super low points from being a range.
      if (highClusters.length === 0 || lowClusters.length === 0) {
        continue;
      }

      const topCluster = highClusters[0];
      const bottomCluster = lowClusters[0];

      // Boundaries are strictly the AVERAGE of the multiple close points
      const upperBoundary = topCluster.avgPrice;
      const lowerBoundary = bottomCluster.avgPrice;
      const height = upperBoundary - lowerBoundary;

      // Range height must be clearly separated and sensible
      if (height <= maxClusterSpread * 1.2) continue;

      // Reject massive vertical heights (max ~20-25 pips on 1m/5m)
      const maxHeightPercent =
        timeframeSeconds <= 60
          ? 0.0018
          : timeframeSeconds <= 300
          ? 0.0024
          : 0.0038;
      if (height / windowMidPrice > maxHeightPercent) continue;

      // ----------------------------------------------------
      // OUTLIER REJECTION: No single super high or super low spike
      // ----------------------------------------------------
      const maxWindowHigh = Math.max(...windowCandles.map((c) => c.high));
      const minWindowLow = Math.min(...windowCandles.map((c) => c.low));

      // If any single candle spike went far above the clustered highs or far below the clustered lows, REJECT!
      if (maxWindowHigh > topCluster.maxPrice + maxClusterSpread * 1.2) {
        continue;
      }
      if (minWindowLow < bottomCluster.minPrice - maxClusterSpread * 1.2) {
        continue;
      }

      // ----------------------------------------------------
      // ANTI-TREND FILTER: Linear slope and net drift
      // ----------------------------------------------------
      const netDrift = Math.abs(
        windowCandles[windowCandles.length - 1].close - windowCandles[0].close
      );
      if (netDrift / height > 0.38) {
        continue;
      }

      const slope = Math.abs(calculateCloseSlope(windowCandles));
      const relativeSlopePerBar = (slope / windowMidPrice) * 1000;
      if (relativeSlopePerBar > 0.028) {
        continue;
      }

      // ----------------------------------------------------
      // EQUILIBRIUM OSCILLATIONS (Midline Crossings)
      // Must oscillate back and forth between ceiling and floor
      // ----------------------------------------------------
      const midline = (upperBoundary + lowerBoundary) / 2;
      let midlineCrossings = 0;
      let lastSide = windowCandles[0].close >= midline ? 'above' : 'below';

      for (let cIdx = 1; cIdx < windowCandles.length; cIdx++) {
        const side = windowCandles[cIdx].close >= midline ? 'above' : 'below';
        if (side !== lastSide) {
          midlineCrossings++;
          lastSide = side;
        }
      }

      if (midlineCrossings < 3) {
        continue;
      }

      // Containment check: At least 82% inside range boundaries
      const buffer = height * 0.08;
      const insideCount = windowCandles.filter(
        (c) => c.close >= lowerBoundary - buffer && c.close <= upperBoundary + buffer
      ).length;

      const containment = insideCount / windowCandles.length;
      if (containment < 0.82) continue;

      const startTime = Number(windowCandles[0].time);
      const initialEndTime = Number(windowCandles[windowCandles.length - 1].time);

      // ----------------------------------------------------
      // Strategy B: Continuous Range Tracking & Breakout Monitoring
      // Rule: A range does NOT stop tracking until its limits are fully broken.
      // Limits are fully broken ONLY when 3 consecutive completed closes hold beyond a boundary.
      // ----------------------------------------------------
      const subsequentCandles = lookbackCandles.slice(end + 1);
      const latestCandleTime = Number(lookbackCandles[lookbackCandles.length - 1].time);

      let breakoutState: BreakoutState = 'inside';
      let consecutiveCloses = 0;
      let confirmationTime: number | undefined;
      let isFullyBroken = false;
      let brokenAtIndex = -1;

      let currentDirection: 'bullish' | 'bearish' | null = null;
      let streak = 0;

      for (let k = 0; k < subsequentCandles.length; k++) {
        const c = subsequentCandles[k];

        if (c.close > upperBoundary) {
          if (currentDirection === 'bullish') {
            streak++;
          } else {
            currentDirection = 'bullish';
            streak = 1;
          }
        } else if (c.close < lowerBoundary) {
          if (currentDirection === 'bearish') {
            streak++;
          } else {
            currentDirection = 'bearish';
            streak = 1;
          }
        } else {
          // Closed back inside range -> RESET confirmation count!
          // (Specifically avoids Turtle Soup traps as per specification)
          currentDirection = null;
          streak = 0;
        }

        if (streak >= requiredCloses && !isFullyBroken) {
          isFullyBroken = true;
          brokenAtIndex = end + 1 + k;
          confirmationTime = Number(c.time);
        }
      }

      // If limits were fully broken long ago (> 25 bars ago), this old range has finished
      if (isFullyBroken && brokenAtIndex >= 0 && (lookbackCandles.length - 1 - brokenAtIndex) > 25) {
        continue;
      }

      consecutiveCloses = streak;
      if (currentDirection === 'bullish') {
        breakoutState = streak >= requiredCloses ? 'bullish_confirmed' : 'bullish_pending';
      } else if (currentDirection === 'bearish') {
        breakoutState = streak >= requiredCloses ? 'bearish_confirmed' : 'bearish_pending';
      } else {
        breakoutState = 'inside';
      }

      // CONTINUOUS TRACKING END-TIME:
      // If limits are NOT fully broken, the range continuously tracks right up to the latest live candle!
      // If fully broken, the rectangle tracks through the confirmation candle.
      const trackingEndTime = isFullyBroken && confirmationTime
        ? Math.min(latestCandleTime, confirmationTime + timeframeSeconds * 2)
        : latestCandleTime;

      const totalActiveBars = Math.max(
        windowCandles.length,
        Math.round((trackingEndTime - startTime) / timeframeSeconds) + 1
      );

      const pipMultiplier = precision === 3 || precision === 2 ? 100 : 10000;
      const heightPips = Math.round(height * pipMultiplier * 10) / 10;
      const heightPercent = Math.round((height / windowMidPrice) * 10000) / 100;

      let summary = '';
      let recommendation = '';

      if (breakoutState === 'bullish_confirmed') {
        summary = `Confirmed Bullish Breakout (${consecutiveCloses}/${requiredCloses} closes above ${upperBoundary.toFixed(precision)})`;
        recommendation = `Range limits fully broken upward with 3 confirmed closes. Watch for retest of broken boundary.`;
      } else if (breakoutState === 'bearish_confirmed') {
        summary = `Confirmed Bearish Breakout (${consecutiveCloses}/${requiredCloses} closes below ${lowerBoundary.toFixed(precision)})`;
        recommendation = `Range limits fully broken downward with 3 confirmed closes. Watch for retest of broken boundary.`;
      } else if (breakoutState === 'bullish_pending') {
        summary = `Bullish Breakout Attempt (${consecutiveCloses}/${requiredCloses} closes · Continuous Tracking)`;
        recommendation = `Price crossed above ceiling but limits not fully broken yet. DO NOT ENTER: awaiting ${requiredCloses - consecutiveCloses} more completed close(s) to confirm.`;
      } else if (breakoutState === 'bearish_pending') {
        summary = `Bearish Breakout Attempt (${consecutiveCloses}/${requiredCloses} closes · Continuous Tracking)`;
        recommendation = `Price crossed below floor but limits not fully broken yet. DO NOT ENTER: awaiting ${requiredCloses - consecutiveCloses} more completed close(s) to confirm.`;
      } else {
        summary = `Active Consolidation (${heightPips} pips · ${totalActiveBars} bars continuous tracking)`;
        recommendation = `Limits intact. Price oscillating between ${lowerBoundary.toFixed(precision)} and ${upperBoundary.toFixed(precision)}. Continuously tracking until limits are fully broken.`;
      }

      // Quality score: points in cluster + oscillations - drift - slope + longevity
      const score =
        (topCluster.points.length + bottomCluster.points.length) * 12 +
        midlineCrossings * 8 +
        containment * 25 +
        (isFullyBroken ? 10 : 30) - // Active unbroken ranges prioritized
        (topCluster.spread + bottomCluster.spread) * 1000 -
        relativeSlopePerBar * 120;

      candidates.push({
        score,
        range: {
          id: `range_${startTime}_${initialEndTime}`,
          startIndex: start,
          endIndex: isFullyBroken && brokenAtIndex >= 0 ? brokenAtIndex : lookbackCandles.length - 1,
          startTime,
          endTime: trackingEndTime,
          upperBoundary,
          lowerBoundary,
          heightPips,
          heightPercent,
          candleCount: totalActiveBars,
          swingHighs: topCluster.points,
          swingLows: bottomCluster.points,
          breakoutState,
          consecutiveCloses,
          requiredCloses,
          confirmationTime,
          summary,
          recommendation,
        },
      });
    }
  }

  if (candidates.length === 0) return [];

  // Sort candidates by quality score descending
  candidates.sort((a, b) => b.score - a.score);

  // Keep strictly the single highest-quality, clean primary range
  return [candidates[0].range];
}

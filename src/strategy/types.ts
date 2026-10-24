import type { DrawingItem } from '../drawings/types';
import type { KeyLevel } from './keyLevelDetector';

export type BreakoutState =
  | 'inside'
  | 'bullish_pending'
  | 'bearish_pending'
  | 'bullish_confirmed'
  | 'bearish_confirmed';

export interface SwingPoint {
  index: number;
  time: number;
  price: number;
  type: 'high' | 'low';
}

export interface DetectedRange {
  id: string;
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  upperBoundary: number; // Average of swing highs
  lowerBoundary: number; // Average of swing lows
  heightPips: number;
  heightPercent: number;
  candleCount: number;
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  breakoutState: BreakoutState;
  consecutiveCloses: number;
  requiredCloses: number;
  confirmationTime?: number;
  summary: string;
  recommendation: string;
}

export interface FairValueGap {
  id: string;
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  startTime: number;
  mitigated: boolean;
  mitigationTime?: number;
}

export interface ImpulseLeg {
  startTime: number;
  endTime: number;
  startPrice: number;
  endPrice: number;
  direction: 'bullish' | 'bearish';
  fib382: number;
  fib500: number;
  fib618: number;
  fib786: number;
}

export interface StrategyAnalysisResult {
  symbol: string;
  timeframeLabel: string;
  timeframeSeconds: number;
  evaluatedAt: number;
  lookbackCandles: number;
  detectedRanges: DetectedRange[];
  primaryRange: DetectedRange | null;
  activeImpulse: ImpulseLeg | null;
  unmitigatedFVGs: FairValueGap[];
  keyLevels: KeyLevel[];
  suggestedDrawings: DrawingItem[];
  statusMessage: string;
}

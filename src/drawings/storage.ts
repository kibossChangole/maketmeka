import type { DrawingItem } from './types';

const STORAGE_PREFIX = 'deriv_chart_drawings_v1_';

export function loadDrawings(symbol: string): DrawingItem[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${symbol}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore
  }
  return [];
}

export function saveDrawings(symbol: string, drawings: DrawingItem[]): void {
  try {
    if (drawings.length === 0) {
      localStorage.removeItem(`${STORAGE_PREFIX}${symbol}`);
    } else {
      localStorage.setItem(`${STORAGE_PREFIX}${symbol}`, JSON.stringify(drawings));
    }
  } catch {
    // ignore
  }
}

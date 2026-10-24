export type ActiveTool = 'cursor' | 'line' | 'rectangle' | 'fibonacci';

export type DrawingType = 'line' | 'rectangle' | 'fibonacci' | 'keyLevel';

export interface ChartPoint {
  time: number; // Unix epoch in seconds
  price: number;
}

export interface DrawingItem {
  id: string;
  type: DrawingType;
  p1: ChartPoint;
  p2: ChartPoint;
  color: string;
  label?: string;
}

export interface FiboLevel {
  ratio: number;
  label: string;
  color: string;
}

export const FIBO_LEVELS: FiboLevel[] = [
  { ratio: 0.0, label: '0.0%', color: '#94a3b8' },
  { ratio: 0.236, label: '23.6%', color: '#f87171' },
  { ratio: 0.382, label: '38.2%', color: '#fbbf24' },
  { ratio: 0.500, label: '50.0%', color: '#38bdf8' },
  { ratio: 0.618, label: '61.8%', color: '#34d399' },
  { ratio: 0.786, label: '78.6%', color: '#a78bfa' },
  { ratio: 1.000, label: '100.0%', color: '#94a3b8' },
];

export const DRAWING_COLORS = [
  '#38bdf8', // Neon Sky Blue (default)
  '#22c98a', // Deriv Green
  '#f59e0b', // Golden Amber
  '#f43f5e', // Vibrant Rose
  '#a855f7', // Purple
  '#ffffff', // Clean White
];

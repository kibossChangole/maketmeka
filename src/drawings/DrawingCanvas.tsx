import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import {
  type ActiveTool,
  type ChartPoint,
  type DrawingItem,
  FIBO_LEVELS,
} from './types';
import type { Candle } from '../App';
import type { TrendOverlay } from '../strategy/trendDetector';

interface DrawingCanvasProps {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  candles: Candle[];
  timeframeSeconds: number;
  precision: number;
  activeTool: ActiveTool;
  onToolUsed: () => void;
  currentColor: string;
  drawings: DrawingItem[];
  onDrawingsChange: (drawings: DrawingItem[]) => void;
  selectedId: string | null;
  onSelectDrawing: (id: string | null) => void;
  /** Optional trend continuation overlay shown on confirmed breakout */
  trendOverlay?: TrendOverlay | null;
  showTrendOverlay?: boolean;
}

function hexToRgba(hex: string, alpha: number): string {
  let c = hex.replace('#', '');
  if (c.length === 3) {
    c = c.split('').map((char) => char + char).join('');
  }
  const num = parseInt(c, 16);
  if (isNaN(num)) return `rgba(56, 189, 248, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

export const DrawingCanvas: React.FC<DrawingCanvasProps> = ({
  chart,
  series,
  candles,
  timeframeSeconds,
  precision,
  activeTool,
  onToolUsed,
  currentColor,
  drawings,
  onDrawingsChange,
  selectedId,
  onSelectDrawing,
  trendOverlay,
  showTrendOverlay = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const [hoveredDrawingId, setHoveredDrawingId] = useState<string | null>(null);
  const [hoveredHandle, setHoveredHandle] = useState<'p1' | 'p2' | 'body' | null>(null);

  // In-progress creation state
  const creatingRef = useRef<{
    startPoint: ChartPoint;
    currentPoint: ChartPoint;
  } | null>(null);

  // In-progress drag state
  const draggingRef = useRef<{
    drawingId: string;
    handle: 'p1' | 'p2' | 'body';
    initialP1: ChartPoint;
    initialP2: ChartPoint;
    startMouse: { x: number; y: number };
    startChartPoint: ChartPoint;
  } | null>(null);

  // Convert chart point (time, price) -> pixel (x, y)
  const pointToPixels = useCallback((point: ChartPoint): { x: number; y: number } | null => {
    if (!chart || !series) return null;
    const y = series.priceToCoordinate(point.price);
    if (y === null) return null;

    let x = chart.timeScale().timeToCoordinate(point.time as Time);
    if (x === null && candles.length > 0) {
      // Extrapolate logical coordinate if beyond loaded bars
      const lastCandle = candles[candles.length - 1];
      const lastTime = Number(lastCandle.time);
      const diffSeconds = point.time - lastTime;
      const logicalDiff = diffSeconds / timeframeSeconds;
      const logicalIndex = candles.length - 1 + logicalDiff;
      x = chart.timeScale().logicalToCoordinate(logicalIndex as any);
    }

    if (x === null) return null;
    return { x, y };
  }, [chart, series, candles, timeframeSeconds]);

  // Convert pixel (x, y) -> chart point (time, price)
  const pixelsToPoint = useCallback((x: number, y: number): ChartPoint | null => {
    if (!chart || !series) return null;
    const price = series.coordinateToPrice(y);
    if (price === null) return null;

    let time: number | null = null;
    const directTime = chart.timeScale().coordinateToTime(x);
    if (directTime !== null && typeof directTime === 'number') {
      time = directTime;
    } else {
      const logical = chart.timeScale().coordinateToLogical(x);
      if (logical !== null && candles.length > 0) {
        const lastCandle = candles[candles.length - 1];
        const lastIndex = candles.length - 1;
        const diffIndex = logical - lastIndex;
        time = Number(lastCandle.time) + Math.round(diffIndex * timeframeSeconds);
      }
    }

    if (time === null) return null;
    return { time, price };
  }, [chart, series, candles, timeframeSeconds]);

  // Render all drawings on canvas
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !chart || !series) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Draw saved items
    drawings.forEach((item) => {
      const p1Pix = pointToPixels(item.p1);
      const p2Pix = pointToPixels(item.p2);
      if (!p1Pix || !p2Pix) return;

      const isSelected = item.id === selectedId;
      const isHovered = item.id === hoveredDrawingId;

      ctx.save();
      ctx.lineWidth = isSelected ? 2.5 : isHovered ? 2 : 1.5;
      ctx.strokeStyle = item.color;
      ctx.fillStyle = hexToRgba(item.color, 0.18);

      if (item.type === 'line') {
        // Trendline
        ctx.beginPath();
        ctx.moveTo(p1Pix.x, p1Pix.y);
        ctx.lineTo(p2Pix.x, p2Pix.y);
        ctx.stroke();

        // Length & delta badge
        if (isSelected || isHovered) {
          const midX = (p1Pix.x + p2Pix.x) / 2;
          const midY = (p1Pix.y + p2Pix.y) / 2;
          const deltaPrice = item.p2.price - item.p1.price;
          const sign = deltaPrice >= 0 ? '+' : '';
          const tag = `${sign}${deltaPrice.toFixed(precision)}`;

          ctx.font = '10px Inter, sans-serif';
          const textWidth = ctx.measureText(tag).width;
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(midX - textWidth / 2 - 4, midY - 18, textWidth + 8, 16);
          ctx.strokeStyle = item.color;
          ctx.strokeRect(midX - textWidth / 2 - 4, midY - 18, textWidth + 8, 16);
          ctx.fillStyle = '#f8fafc';
          ctx.fillText(tag, midX - textWidth / 2, midY - 6);
        }
      } else if (item.type === 'rectangle') {
        // Rectangle
        const rx = Math.min(p1Pix.x, p2Pix.x);
        const ry = Math.min(p1Pix.y, p2Pix.y);
        const rw = Math.abs(p2Pix.x - p1Pix.x);
        const rh = Math.abs(p2Pix.y - p1Pix.y);

        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeRect(rx, ry, rw, rh);

        if (item.label) {
          ctx.save();
          ctx.font = 'bold 9px "Inter", sans-serif';
          const textWidth = ctx.measureText(item.label).width;
          const badgeY = ry - 20 < 10 ? ry + 4 : ry - 20;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
          ctx.fillRect(rx + 4, badgeY, textWidth + 10, 16);
          ctx.strokeStyle = item.color;
          ctx.lineWidth = 1;
          ctx.strokeRect(rx + 4, badgeY, textWidth + 10, 16);
          ctx.fillStyle = item.color;
          ctx.fillText(item.label, rx + 9, badgeY + 11);
          ctx.restore();
        }
      } else if (item.type === 'fibonacci') {
        // Fibonacci Retracement
        const xStart = Math.min(p1Pix.x, p2Pix.x);
        const xEnd = Math.max(p1Pix.x, p2Pix.x) + 30; // slightly extend for clarity

        // Baseline
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.moveTo(p1Pix.x, p1Pix.y);
        ctx.lineTo(p2Pix.x, p2Pix.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Render each Fibonacci level
        FIBO_LEVELS.forEach((level) => {
          const levelPrice = item.p1.price + level.ratio * (item.p2.price - item.p1.price);
          const y = series.priceToCoordinate(levelPrice);
          if (y === null) return;

          ctx.beginPath();
          ctx.strokeStyle = level.color;
          ctx.lineWidth = 1;
          ctx.moveTo(xStart, y);
          ctx.lineTo(xEnd, y);
          ctx.stroke();

          // Label
          ctx.font = '9px "DM Mono", monospace';
          const labelText = `${level.label} (${levelPrice.toFixed(precision)})`;
          ctx.fillStyle = level.color;
          ctx.fillText(labelText, xEnd + 6, y + 3);
        });
      } else if (item.type === 'keyLevel') {
        // Simple subtle dotted line for historical reversal levels
        const y = series.priceToCoordinate(item.p1.price);
        if (y !== null) {
          ctx.beginPath();
          ctx.setLineDash([3, 4]); // Simple dotted line that isn't too distracting
          ctx.strokeStyle = item.color;
          ctx.lineWidth = isSelected ? 2 : isHovered ? 1.5 : 1;
          ctx.moveTo(0, y);
          ctx.lineTo(width, y);
          ctx.stroke();
          ctx.setLineDash([]);

          if (item.label) {
            ctx.save();
            ctx.font = '500 9px "Inter", sans-serif';
            const textWidth = ctx.measureText(item.label).width;
            const badgeX = Math.max(8, width - textWidth - 16);
            const badgeY = y - 14 < 6 ? y + 4 : y - 14;

            ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
            ctx.fillRect(badgeX - 4, badgeY, textWidth + 8, 14);
            ctx.strokeStyle = hexToRgba(item.color, 0.4);
            ctx.lineWidth = 1;
            ctx.strokeRect(badgeX - 4, badgeY, textWidth + 8, 14);
            ctx.fillStyle = item.color;
            ctx.fillText(item.label, badgeX, badgeY + 10);
            ctx.restore();
          }
        }
      }

      // Draw anchor handles if selected or hovered
      if (isSelected || isHovered) {
        [p1Pix, p2Pix].forEach((pt) => {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, isSelected ? 5 : 4, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.strokeStyle = item.color;
          ctx.lineWidth = 2;
          ctx.stroke();
        });
      }

      ctx.restore();
    });

    // Draw in-progress creation preview
    if (creatingRef.current) {
      const p1Pix = pointToPixels(creatingRef.current.startPoint);
      const p2Pix = pointToPixels(creatingRef.current.currentPoint);
      if (p1Pix && p2Pix) {
        ctx.save();
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = 2;
        ctx.fillStyle = hexToRgba(currentColor, 0.2);

        if (activeTool === 'line') {
          ctx.beginPath();
          ctx.moveTo(p1Pix.x, p1Pix.y);
          ctx.lineTo(p2Pix.x, p2Pix.y);
          ctx.stroke();
        } else if (activeTool === 'rectangle') {
          const rx = Math.min(p1Pix.x, p2Pix.x);
          const ry = Math.min(p1Pix.y, p2Pix.y);
          const rw = Math.abs(p2Pix.x - p1Pix.x);
          const rh = Math.abs(p2Pix.y - p1Pix.y);
          ctx.fillRect(rx, ry, rw, rh);
          ctx.strokeRect(rx, ry, rw, rh);
        } else if (activeTool === 'fibonacci') {
          const xStart = Math.min(p1Pix.x, p2Pix.x);
          const xEnd = Math.max(p1Pix.x, p2Pix.x) + 30;

          ctx.beginPath();
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.moveTo(p1Pix.x, p1Pix.y);
          ctx.lineTo(p2Pix.x, p2Pix.y);
          ctx.stroke();
          ctx.setLineDash([]);

          FIBO_LEVELS.forEach((level) => {
            const levelPrice = creatingRef.current!.startPoint.price + level.ratio * (creatingRef.current!.currentPoint.price - creatingRef.current!.startPoint.price);
            const y = series.priceToCoordinate(levelPrice);
            if (y === null) return;
            ctx.beginPath();
            ctx.strokeStyle = level.color;
            ctx.moveTo(xStart, y);
            ctx.lineTo(xEnd, y);
            ctx.stroke();

            ctx.font = '9px "DM Mono", monospace';
            ctx.fillStyle = level.color;
            ctx.fillText(`${level.label} (${levelPrice.toFixed(precision)})`, xEnd + 6, y + 3);
          });
        }

        [p1Pix, p2Pix].forEach((pt) => {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          ctx.stroke();
        });

        ctx.restore();
      }
    }

    // ─── Trend Continuation Overlay ───────────────────────────────────────
    // Rendered on top of everything when a confirmed breakout is detected.
    if (trendOverlay && showTrendOverlay) {
      ctx.save();

      const isBull = trendOverlay.direction === 'bullish';
      const trendColor = isBull ? 'rgba(52,211,153,0.85)' : 'rgba(251,113,133,0.85)';
      const trendColorFaint = isBull ? 'rgba(52,211,153,0.25)' : 'rgba(251,113,133,0.25)';

      // ── 1. Fibonacci retracement zones (thin horizontal dotted lines) ──
      for (const zone of trendOverlay.fibZones) {
        const y = series.priceToCoordinate(zone.price);
        if (y === null) continue;

        ctx.beginPath();
        ctx.setLineDash([2, 5]);
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = zone.color;
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Small label on right edge
        ctx.font = '8px "DM Mono", monospace';
        ctx.fillStyle = zone.color;
        const fibLabel = `${zone.label} · ${zone.price.toFixed(precision)}`;
        ctx.fillText(fibLabel, width - ctx.measureText(fibLabel).width - 6, y - 3);
      }

      // ── 2. Continuation target dotted horizontal ──
      const targetY = series.priceToCoordinate(trendOverlay.continuationTarget);
      if (targetY !== null) {
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = trendColor;
        ctx.moveTo(0, targetY);
        ctx.lineTo(width, targetY);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = 'bold 8px "Inter", sans-serif';
        const targetLabel = `Target · ${trendOverlay.continuationTarget.toFixed(precision)}`;
        const tlWidth = ctx.measureText(targetLabel).width;
        ctx.fillStyle = 'rgba(15,23,42,0.85)';
        ctx.fillRect(width - tlWidth - 12, targetY - 13, tlWidth + 8, 13);
        ctx.fillStyle = trendColor;
        ctx.fillText(targetLabel, width - tlWidth - 8, targetY - 3);
      }

      // ── 3. Diagonal trendline (thin, extended to right edge) ──
      const tlP1 = pointToPixels({ time: trendOverlay.trendlineP1.time, price: trendOverlay.trendlineP1.price });
      const tlP2 = pointToPixels({ time: trendOverlay.trendlineP2.time, price: trendOverlay.trendlineP2.price });

      if (tlP1 && tlP2) {
        const slope = (tlP2.y - tlP1.y) / (tlP2.x - tlP1.x || 1);
        const extendedY = tlP2.y + slope * (width - tlP2.x);

        // Shaded channel fill (very subtle)
        const channelOffset = Math.abs(tlP2.y - tlP1.y) * 0.3;
        ctx.beginPath();
        ctx.moveTo(tlP1.x, tlP1.y - (isBull ? channelOffset : -channelOffset));
        ctx.lineTo(width, extendedY - (isBull ? channelOffset : -channelOffset));
        ctx.lineTo(width, extendedY + (isBull ? channelOffset : -channelOffset));
        ctx.lineTo(tlP1.x, tlP1.y + (isBull ? channelOffset : -channelOffset));
        ctx.closePath();
        ctx.fillStyle = trendColorFaint;
        ctx.fill();

        // Main diagonal trendline
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = trendColor;
        ctx.moveTo(tlP1.x, tlP1.y);
        ctx.lineTo(width, extendedY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // ── 4. Light dots at each swing point (HH/HL or LH/LL) ──
      for (const swing of trendOverlay.swings) {
        const pt = pointToPixels({ time: swing.time, price: swing.price });
        if (!pt) continue;

        // Outer glow ring
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = trendColorFaint;
        ctx.fill();

        // Inner dot
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = trendColor;
        ctx.fill();

        // Swing type label just above/below dot
        ctx.font = 'bold 7.5px "Inter", sans-serif';
        ctx.fillStyle = trendColor;
        const labelY = isBull
          ? (swing.type === 'HH' ? pt.y - 10 : pt.y + 16)
          : (swing.type === 'LH' ? pt.y - 10 : pt.y + 16);
        ctx.fillText(swing.type, pt.x - 6, labelY);
      }

      ctx.restore();
    }
    // ──────────────────────────────────────────────────────────────────────

    ctx.restore();
  }, [chart, series, drawings, selectedId, hoveredDrawingId, currentColor, activeTool, precision, pointToPixels, trendOverlay, showTrendOverlay]);

  // Hook into chart timescale visible range changes to redraw
  useEffect(() => {
    if (!chart) return;
    const timeScale = chart.timeScale();
    const handleRangeChange = () => render();
    timeScale.subscribeVisibleLogicalRangeChange(handleRangeChange);
    timeScale.subscribeVisibleTimeRangeChange(handleRangeChange);

    const observer = new ResizeObserver(() => render());
    if (canvasRef.current) observer.observe(canvasRef.current);

    render();

    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(handleRangeChange);
      timeScale.unsubscribeVisibleTimeRangeChange(handleRangeChange);
      observer.disconnect();
    };
  }, [chart, render]);

  // Re-render when drawings or candles change
  useEffect(() => {
    render();
  }, [render, candles]);

  // Handle pointer down (starting draw or starting drag handle)
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const pt = pixelsToPoint(mouseX, mouseY);
    if (!pt) return;

    if (activeTool !== 'cursor') {
      // Start creating new drawing
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsInteracting(true);
      creatingRef.current = {
        startPoint: pt,
        currentPoint: pt,
      };
      render();
      return;
    }

    // In cursor mode: check if clicking handle or drawing
    if (hoveredDrawingId && hoveredHandle) {
      const target = drawings.find((d) => d.id === hoveredDrawingId);
      if (target) {
        e.currentTarget.setPointerCapture(e.pointerId);
        setIsInteracting(true);
        onSelectDrawing(target.id);
        draggingRef.current = {
          drawingId: target.id,
          handle: hoveredHandle,
          initialP1: { ...target.p1 },
          initialP2: { ...target.p2 },
          startMouse: { x: mouseX, y: mouseY },
          startChartPoint: pt,
        };
        return;
      }
    }

    // Clicked empty space
    onSelectDrawing(null);
  };

  // Handle pointer move
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const pt = pixelsToPoint(mouseX, mouseY);

    // In-progress creation
    if (creatingRef.current && pt) {
      creatingRef.current.currentPoint = pt;
      render();
      return;
    }

    // In-progress dragging of handle/body
    if (draggingRef.current && pt) {
      const { drawingId, handle, initialP1, initialP2, startChartPoint } = draggingRef.current;
      const updated = drawings.map((d) => {
        if (d.id !== drawingId) return d;
        if (handle === 'p1') {
          return { ...d, p1: pt };
        } else if (handle === 'p2') {
          return { ...d, p2: pt };
        } else {
          // Move whole body
          const deltaPrice = pt.price - startChartPoint.price;
          const deltaTime = pt.time - startChartPoint.time;
          return {
            ...d,
            p1: { time: initialP1.time + deltaTime, price: initialP1.price + deltaPrice },
            p2: { time: initialP2.time + deltaTime, price: initialP2.price + deltaPrice },
          };
        }
      });
      onDrawingsChange(updated);
      render();
      return;
    }

    // Hit test if in cursor mode
    if (activeTool === 'cursor') {
      let foundDrawingId: string | null = null;
      let foundHandle: 'p1' | 'p2' | 'body' | null = null;

      // Check handles of selected item first, then other items
      const ordered = [...drawings].sort((a, _b) => (a.id === selectedId ? 1 : -1));

      for (const item of ordered) {
        const p1Pix = pointToPixels(item.p1);
        const p2Pix = pointToPixels(item.p2);
        if (!p1Pix || !p2Pix) continue;

        // Check p1 handle
        if (Math.hypot(mouseX - p1Pix.x, mouseY - p1Pix.y) <= 8) {
          foundDrawingId = item.id;
          foundHandle = 'p1';
          break;
        }
        // Check p2 handle
        if (Math.hypot(mouseX - p2Pix.x, mouseY - p2Pix.y) <= 8) {
          foundDrawingId = item.id;
          foundHandle = 'p2';
          break;
        }

        // Check line/body hit
        if (item.type === 'line') {
          if (distToSegment(mouseX, mouseY, p1Pix.x, p1Pix.y, p2Pix.x, p2Pix.y) <= 6) {
            foundDrawingId = item.id;
            foundHandle = 'body';
            break;
          }
        } else if (item.type === 'rectangle') {
          const rx = Math.min(p1Pix.x, p2Pix.x);
          const ry = Math.min(p1Pix.y, p2Pix.y);
          const rw = Math.abs(p2Pix.x - p1Pix.x);
          const rh = Math.abs(p2Pix.y - p1Pix.y);

          const isInside = mouseX >= rx && mouseX <= rx + rw && mouseY >= ry && mouseY <= ry + rh;
          const nearBorder =
            (Math.abs(mouseX - rx) <= 6 || Math.abs(mouseX - (rx + rw)) <= 6) && mouseY >= ry - 6 && mouseY <= ry + rh + 6 ||
            (Math.abs(mouseY - ry) <= 6 || Math.abs(mouseY - (ry + rh)) <= 6) && mouseX >= rx - 6 && mouseX <= rx + rw + 6;

          if (isInside || nearBorder) {
            foundDrawingId = item.id;
            foundHandle = 'body';
            break;
          }
        } else if (item.type === 'fibonacci') {
          const xStart = Math.min(p1Pix.x, p2Pix.x);
          const xEnd = Math.max(p1Pix.x, p2Pix.x) + 30;

          // Check baseline
          if (distToSegment(mouseX, mouseY, p1Pix.x, p1Pix.y, p2Pix.x, p2Pix.y) <= 6) {
            foundDrawingId = item.id;
            foundHandle = 'body';
            break;
          }

          // Check any horizontal line
          let hitFiboLine = false;
          for (const level of FIBO_LEVELS) {
            const levelPrice = item.p1.price + level.ratio * (item.p2.price - item.p1.price);
            const y = series?.priceToCoordinate(levelPrice);
            if (y != null && Math.abs(mouseY - y) <= 6 && mouseX >= xStart - 10 && mouseX <= xEnd + 80) {
              hitFiboLine = true;
              break;
            }
          }
          if (hitFiboLine) {
            foundDrawingId = item.id;
            foundHandle = 'body';
            break;
          }
        } else if (item.type === 'keyLevel') {
          const y = series?.priceToCoordinate(item.p1.price);
          if (y != null && Math.abs(mouseY - y) <= 6) {
            foundDrawingId = item.id;
            foundHandle = 'body';
            break;
          }
        }
      }

      setHoveredDrawingId(foundDrawingId);
      setHoveredHandle(foundHandle);
      render();
    }
  };

  // Handle pointer up
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (creatingRef.current) {
      const { startPoint, currentPoint } = creatingRef.current;
      // Only commit if points are not identical
      if (startPoint.time !== currentPoint.time || startPoint.price !== currentPoint.price) {
        const newItem: DrawingItem = {
          id: `draw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          type: activeTool as any,
          p1: startPoint,
          p2: currentPoint,
          color: currentColor,
        };
        const nextDrawings = [...drawings, newItem];
        onDrawingsChange(nextDrawings);
        onSelectDrawing(newItem.id);
        onToolUsed(); // return to cursor mode so trader can pan or adjust
      }
      creatingRef.current = null;
    }

    if (draggingRef.current) {
      draggingRef.current = null;
    }

    setIsInteracting(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    render();
  };

  // Handle keyboard shortcut (Delete / Backspace / Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        onDrawingsChange(drawings.filter((d) => d.id !== selectedId));
        onSelectDrawing(null);
      } else if (e.key === 'Escape') {
        creatingRef.current = null;
        onSelectDrawing(null);
        onToolUsed();
        render();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, drawings, onDrawingsChange, onSelectDrawing, onToolUsed, render]);

  // Determine cursor appearance
  const cursorStyle = activeTool !== 'cursor'
    ? 'crosshair'
    : hoveredHandle === 'p1' || hoveredHandle === 'p2'
    ? 'grab'
    : hoveredHandle === 'body'
    ? 'move'
    : 'default';

  // Pointer events: active if in drawing mode or hovering an interactive handle/drawing
  const hasInteractiveTarget = activeTool !== 'cursor' || isInteracting || hoveredDrawingId !== null;

  return (
    <canvas
      ref={canvasRef}
      className="drawing-overlay-canvas"
      style={{
        pointerEvents: hasInteractiveTarget ? 'auto' : 'none',
        cursor: cursorStyle,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  );
};

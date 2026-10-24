import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type Time,
} from 'lightweight-charts';
import {
  Activity,
  ChevronDown,
  CircleHelp,
  Clock,
  Grid2X2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Settings2,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { formatEATDateTime, formatEATTickMark, getCurrentEATString } from './utils/eatTime';
import { DrawingCanvas } from './drawings/DrawingCanvas';
import { DrawingToolbar } from './drawings/DrawingToolbar';
import { type ActiveTool, type DrawingItem, DRAWING_COLORS } from './drawings/types';
import { loadDrawings, saveDrawings } from './drawings/storage';
import { OpportunityDrawer } from './components/OpportunityDrawer';
import { analyzeChartMarket } from './strategy/strategyEngine';
import type { StrategyAnalysisResult } from './strategy/types';

export type DerivSymbol = {
  symbol: string;
  display_name: string;
  market?: string;
  submarket?: string;
};

export type Candle = CandlestickData<Time> & { time: Time };
export type Tf = { label: string; seconds: number };

export const TIMEFRAMES: Tf[] = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '30m', seconds: 1800 },
  { label: '1h', seconds: 3600 },
  { label: '2h', seconds: 7200 },
  { label: '4h', seconds: 14400 },
];

export const FALLBACK_FOREX: DerivSymbol[] = [
  { symbol: 'frxEURUSD', display_name: 'EUR/USD', market: 'forex', submarket: 'major_pairs' },
  { symbol: 'frxGBPUSD', display_name: 'GBP/USD', market: 'forex', submarket: 'major_pairs' },
  { symbol: 'frxUSDJPY', display_name: 'USD/JPY', market: 'forex', submarket: 'major_pairs' },
  { symbol: 'frxAUDUSD', display_name: 'AUD/USD', market: 'forex', submarket: 'major_pairs' },
  { symbol: 'frxUSDCAD', display_name: 'USD/CAD', market: 'forex', submarket: 'major_pairs' },
  { symbol: 'frxUSDCHF', display_name: 'USD/CHF', market: 'forex', submarket: 'major_pairs' },
  { symbol: 'frxEURGBP', display_name: 'EUR/GBP', market: 'forex', submarket: 'major_pairs' },
  { symbol: 'frxEURJPY', display_name: 'EUR/JPY', market: 'forex', submarket: 'major_pairs' },
  { symbol: 'frxGBPJPY', display_name: 'GBP/JPY', market: 'forex', submarket: 'major_pairs' },
  { symbol: 'frxAUDJPY', display_name: 'AUD/JPY', market: 'forex', submarket: 'major_pairs' },
  { symbol: 'frxNZDUSD', display_name: 'NZD/USD', market: 'forex', submarket: 'minor_pairs' },
  { symbol: 'frxEURAUD', display_name: 'EUR/AUD', market: 'forex', submarket: 'major_pairs' },
  { symbol: 'frxGBPCAD', display_name: 'GBP/CAD', market: 'forex', submarket: 'minor_pairs' },
  { symbol: 'frxEURCAD', display_name: 'EUR/CAD', market: 'forex', submarket: 'major_pairs' },
  { symbol: 'frxAUDCAD', display_name: 'AUD/CAD', market: 'forex', submarket: 'minor_pairs' },
  { symbol: 'frxAUDNZD', display_name: 'AUD/NZD', market: 'forex', submarket: 'minor_pairs' },
  { symbol: 'R_75', display_name: 'Volatility 75 Index', market: 'synthetic_index', submarket: 'random_index' },
  { symbol: 'R_100', display_name: 'Volatility 100 Index', market: 'synthetic_index', submarket: 'random_index' },
];

const APP_ID_DEFAULT = '34JYYzoddrJznYCJ9lVmE';

function getEndpoints(appId: string): string[] {
  const clean = appId.trim();
  const endpoints: string[] = [];
  if (clean) {
    endpoints.push(`wss://api.derivws.com/trading/v1/options/ws/public?app_id=${encodeURIComponent(clean)}`);
  }
  endpoints.push('wss://api.derivws.com/trading/v1/options/ws/public');
  if (clean) {
    endpoints.push(`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(clean)}`);
    endpoints.push(`wss://ws.binaryws.com/websockets/v3?app_id=${encodeURIComponent(clean)}`);
  } else {
    endpoints.push('wss://ws.derivws.com/websockets/v3?app_id=1089');
    endpoints.push('wss://ws.binaryws.com/websockets/v3?app_id=1089');
  }
  return Array.from(new Set(endpoints));
}

function getDecimals(pip: unknown): number {
  if (typeof pip !== 'number' || !Number.isFinite(pip)) return 5;
  if (pip >= 1) return Math.min(Math.round(pip), 8);
  const s = pip.toString();
  const match = s.match(/(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!match) return 5;
  const decimals = match[1] ? match[1].length : 0;
  return Math.min(Math.max(decimals, 2), 8);
}

function toCandle(raw: any): Candle | null {
  const epoch = Number(raw?.open_time ?? raw?.epoch);
  const open = Number(raw?.open);
  const high = Number(raw?.high);
  const low = Number(raw?.low);
  const close = Number(raw?.close);
  if (!Number.isFinite(epoch) || ![open, high, low, close].every(Number.isFinite)) return null;
  return { time: epoch as Time, open, high, low, close };
}

interface ChartPaneProps {
  id: number;
  appId: string;
  initialSymbol: string;
  initialTimeframe: Tf;
  symbols: DerivSymbol[];
  isMaximized: boolean;
  onToggleMaximize: () => void;
  analysisTriggerSeq: number;
  clearAnalysisSeq: number;
  onAnalysisResult: (paneId: number, result: StrategyAnalysisResult) => void;
}

function ChartPane({
  id,
  appId,
  initialSymbol,
  initialTimeframe,
  symbols,
  isMaximized,
  onToggleMaximize,
  analysisTriggerSeq,
  clearAnalysisSeq,
  onAnalysisResult,
}: ChartPaneProps) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [timeframe, setTimeframe] = useState<Tf>(initialTimeframe);
  const [status, setStatus] = useState<'connecting' | 'live' | 'disconnected' | 'error'>('connecting');
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [change, setChange] = useState<number | null>(null);
  const [precision, setPrecision] = useState(5);
  const [message, setMessage] = useState('Connecting…');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [showSymbolMenu, setShowSymbolMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Chart and drawing engine state
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const [seriesApi, setSeriesApi] = useState<ISeriesApi<'Candlestick'> | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [activeTool, setActiveTool] = useState<ActiveTool>('cursor');
  const [currentColor, setCurrentColor] = useState<string>(DRAWING_COLORS[0]);
  const [drawings, setDrawings] = useState<DrawingItem[]>(() => loadDrawings(initialSymbol));
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [activeAnalysis, setActiveAnalysis] = useState<StrategyAnalysisResult | null>(null);
  const activeAnalysisRef = useRef<StrategyAnalysisResult | null>(null);
  useEffect(() => {
    activeAnalysisRef.current = activeAnalysis;
  }, [activeAnalysis]);

  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const aliveRef = useRef(true);
  const endpointIndexRef = useRef(0);
  const candlesRef = useRef<Candle[]>([]);

  // Strategy analysis runner for this chart pane
  const runAnalysis = useCallback(() => {
    const list = candlesRef.current;
    if (list.length < 20) return;
    const res = analyzeChartMarket(symbol, timeframe.label, timeframe.seconds, list, precision);
    setActiveAnalysis(res);
    onAnalysisResult(id, res);

    setDrawings((prev) => {
      // Keep manual user drawings, clear or replace previously auto-detected ranges & reversal levels
      const manualOnly = prev.filter((d) => !d.id.startsWith('auto_'));
      const next = res.suggestedDrawings.length > 0 ? [...manualOnly, ...res.suggestedDrawings] : manualOnly;
      saveDrawings(symbol, next);
      return next;
    });
  }, [symbol, timeframe.label, timeframe.seconds, precision, onAnalysisResult, id]);

  // Execute analysis when parent triggers global scan
  const prevTriggerRef = useRef(analysisTriggerSeq);
  useEffect(() => {
    if (analysisTriggerSeq > prevTriggerRef.current) {
      prevTriggerRef.current = analysisTriggerSeq;
      runAnalysis();
    }
  }, [analysisTriggerSeq, runAnalysis]);

  // Clear auto-generated ranges when parent requests clear
  const prevClearRef = useRef(clearAnalysisSeq);
  useEffect(() => {
    if (clearAnalysisSeq > prevClearRef.current) {
      prevClearRef.current = clearAnalysisSeq;
      setDrawings((prev) => {
        const manualOnly = prev.filter((d) => !d.id.startsWith('auto_'));
        saveDrawings(symbol, manualOnly);
        return manualOnly;
      });
      setActiveAnalysis(null);
    }
  }, [clearAnalysisSeq, symbol]);

  // Reload drawings and clear stale analysis when symbol or timeframe changes
  useEffect(() => {
    setDrawings(loadDrawings(symbol));
    setSelectedDrawingId(null);
    setActiveTool('cursor');
    setActiveAnalysis(null);
  }, [symbol, timeframe]);

  // Auto-run analysis every time a fresh batch of history candles is loaded.
  // This fires on the initial load AND whenever timeframe/symbol changes reconnects and fetches new history.
  const prevHistoryLoadedRef = useRef(false);
  useEffect(() => {
    if (historyLoaded && !prevHistoryLoadedRef.current) {
      prevHistoryLoadedRef.current = true;
      // Small delay to let React commit the fresh candles to candlesRef
      const timer = window.setTimeout(() => runAnalysis(), 150);
      return () => window.clearTimeout(timer);
    }
    if (!historyLoaded) {
      prevHistoryLoadedRef.current = false;
    }
  }, [historyLoaded, runAnalysis]);

  const handleDrawingsChange = useCallback((next: DrawingItem[]) => {
    setDrawings(next);
    saveDrawings(symbol, next);
  }, [symbol]);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedDrawingId) return;
    const next = drawings.filter((d) => d.id !== selectedDrawingId);
    setDrawings(next);
    saveDrawings(symbol, next);
    setSelectedDrawingId(null);
  }, [drawings, selectedDrawingId, symbol]);

  const handleClearAll = useCallback(() => {
    setDrawings([]);
    saveDrawings(symbol, []);
    setSelectedDrawingId(null);
  }, [symbol]);

  const selectedSymbol = useMemo(() => {
    return symbols.find((item) => item.symbol === symbol)
      ?? FALLBACK_FOREX.find((item) => item.symbol === symbol)
      ?? { symbol, display_name: symbol };
  }, [symbols, symbol]);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    if (pingTimerRef.current !== null) window.clearInterval(pingTimerRef.current);
    reconnectTimerRef.current = null;
    pingTimerRef.current = null;
  }, []);

  // Initialize chart with East African Time formatting
  useEffect(() => {
    if (!chartHostRef.current) return;
    const chart = createChart(chartHostRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#090e15' },
        textColor: '#8e9eaf',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(148,163,184,0.06)' },
        horzLines: { color: 'rgba(148,163,184,0.06)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#475569', width: 1, style: 3, labelBackgroundColor: '#1e293b' },
        horzLine: { color: '#475569', width: 1, style: 3, labelBackgroundColor: '#1e293b' },
      },
      rightPriceScale: {
        borderColor: 'rgba(148,163,184,0.12)',
        scaleMargins: { top: 0.12, bottom: 0.12 },
      },
      timeScale: {
        borderColor: 'rgba(148,163,184,0.12)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 7,
        minBarSpacing: 3,
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => formatEATTickMark(time, tickMarkType),
      },
      localization: {
        priceFormatter: (price: number) => price.toFixed(precision),
        timeFormatter: (time: Time) => formatEATDateTime(time),
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c98a',
      downColor: '#f0526b',
      borderUpColor: '#22c98a',
      borderDownColor: '#f0526b',
      wickUpColor: '#22c98a',
      wickDownColor: '#f0526b',
      priceLineVisible: true,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;
    setChartApi(chart);
    setSeriesApi(series);

    const observer = new ResizeObserver(() => {
      if (chartHostRef.current) {
        chart.applyOptions({
          width: chartHostRef.current.clientWidth,
          height: chartHostRef.current.clientHeight,
        });
      }
    });
    observer.observe(chartHostRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      setChartApi(null);
      setSeriesApi(null);
    };
  }, []);

  // Update chart price and time format on precision change
  useEffect(() => {
    chartRef.current?.applyOptions({
      localization: {
        priceFormatter: (price: number) => price.toFixed(precision),
        timeFormatter: (time: Time) => formatEATDateTime(time),
      },
    });
  }, [precision]);

  const connect = useCallback((currentAppId: string, currentSymbol: string, granularity: number) => {
    clearTimers();
    const previousSocket = socketRef.current;
    socketRef.current = null;
    if (previousSocket) {
      previousSocket.onclose = null;
      previousSocket.onerror = null;
      previousSocket.close();
    }

    setStatus('connecting');
    setMessage('Connecting…');
    setHistoryLoaded(false);
    setLastPrice(null);
    setChange(null);
    candlesRef.current = [];
    setCandles([]);
    seriesRef.current?.setData([]);

    const cleanAppId = currentAppId.trim();
    const endpoints = getEndpoints(cleanAppId);
    const endpointIndex = endpointIndexRef.current % endpoints.length;
    const url = endpoints[endpointIndex];

    let socket: WebSocket;
    let opened = false;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      setStatus('error');
      setMessage(`WebSocket error: ${error instanceof Error ? error.message : 'failed'}`);
      return;
    }
    socketRef.current = socket;

    socket.onopen = () => {
      if (socketRef.current !== socket) return;
      opened = true;
      endpointIndexRef.current = endpointIndex;
      setStatus('connecting');
      setMessage(`Loading ${currentSymbol}…`);

      // Request historical candles and subscribe to live stream
      socket.send(JSON.stringify({
        ticks_history: currentSymbol,
        end: 'latest',
        count: 500,
        style: 'candles',
        granularity,
        subscribe: 1,
      }));

      pingTimerRef.current = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ ping: 1 }));
      }, 25000);
    };

    socket.onmessage = (event) => {
      if (socketRef.current !== socket) return;
      let data: any;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.error) {
        setStatus('error');
        setMessage(String(data.error.message || 'Deriv error'));
        return;
      }

      if (data.msg_type === 'candles' && Array.isArray(data.candles)) {
        if (data.pip_size !== undefined) {
          setPrecision(getDecimals(data.pip_size));
        }
        const normalized = data.candles.map(toCandle).filter(Boolean) as Candle[];
        normalized.sort((a, b) => Number(a.time) - Number(b.time));
        candlesRef.current = normalized;
        setCandles(normalized);
        seriesRef.current?.setData(normalized);
        chartRef.current?.timeScale().fitContent();
        setHistoryLoaded(true);
        setStatus('live');
        setMessage('Live feed active');
        if (normalized.length) {
          const last = normalized[normalized.length - 1];
          setLastPrice(last.close);
          setChange(last.close - last.open);
        }
        return;
      }

      if (data.msg_type === 'ohlc' && data.ohlc) {
        if (data.ohlc.pip_size !== undefined) {
          setPrecision(getDecimals(data.ohlc.pip_size));
        }
        const candle = toCandle(data.ohlc);
        if (!candle) return;
        const list = candlesRef.current;
        const last = list[list.length - 1];
        if (!last || Number(candle.time) > Number(last.time)) {
          list.push(candle);
          if (list.length > 800) list.shift();
        } else if (Number(candle.time) === Number(last.time)) {
          list[list.length - 1] = candle;
        } else {
          const index = list.findIndex((item) => Number(item.time) === Number(candle.time));
          if (index >= 0) list[index] = candle;
          else return;
        }
        seriesRef.current?.update(candle);
        setCandles([...list]);
        setLastPrice(candle.close);
        setChange(candle.close - candle.open);
        setStatus('live');
        setMessage('Live feed active');

        // Continuous range tracking:
        // As long as limits are not fully broken, continuously extend rectangle to live candle
        if (activeAnalysisRef.current?.primaryRange) {
          const pr = activeAnalysisRef.current.primaryRange;
          const isFullyBroken =
            pr.breakoutState === 'bullish_confirmed' || pr.breakoutState === 'bearish_confirmed';
          if (!isFullyBroken) {
            setDrawings((prev) => {
              let changed = false;
              const next = prev.map((d) => {
                if (d.id.startsWith('auto_range_') && d.p2.time !== Number(candle.time)) {
                  changed = true;
                  return { ...d, p2: { ...d.p2, time: Number(candle.time) } };
                }
                return d;
              });
              if (changed) {
                saveDrawings(symbol, next);
                return next;
              }
              return prev;
            });
          }
        }
      }
    };

    socket.onerror = () => {
      if (socketRef.current !== socket) return;
      setStatus('connecting');
      setMessage(`Reconnecting…`);
    };

    socket.onclose = (event) => {
      if (socketRef.current !== socket) return;
      clearTimers();
      if (!aliveRef.current) return;

      if (!opened && endpointIndex < endpoints.length - 1) {
        endpointIndexRef.current = endpointIndex + 1;
        setStatus('connecting');
        setMessage(`Connecting…`);
        reconnectTimerRef.current = window.setTimeout(() => {
          if (aliveRef.current) connect(cleanAppId, currentSymbol, granularity);
        }, 500);
        return;
      }

      endpointIndexRef.current = 0;
      setStatus('disconnected');
      const info = event.code && event.code !== 1000 ? ` (${event.code})` : '';
      setMessage(`Disconnected${info} · reconnecting`);
      reconnectTimerRef.current = window.setTimeout(() => {
        if (aliveRef.current) connect(cleanAppId, currentSymbol, granularity);
      }, 4000);
    };
  }, [clearTimers]);

  useEffect(() => {
    aliveRef.current = true;
    connect(appId, symbol, timeframe.seconds);
    return () => {
      aliveRef.current = false;
      clearTimers();
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [appId, symbol, timeframe.seconds, connect, clearTimers]);

  const filteredSymbols = useMemo(() => {
    const list = symbols.length ? symbols : FALLBACK_FOREX;
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter((s) => s.display_name.toLowerCase().includes(q) || s.symbol.toLowerCase().includes(q));
  }, [symbols, searchQuery]);

  const priceText = lastPrice === null ? '—' : lastPrice.toFixed(precision);
  const changeText = change === null ? 'Waiting…' : `${change >= 0 ? '+' : ''}${change.toFixed(precision)}`;

  return (
    <div className={`chart-pane ${isMaximized ? 'maximized' : ''}`}>
      {/* Pane Top Bar: Currency picker, Time picker, Price, Controls */}
      <div className="pane-header">
        <div className="pane-instrument">
          <div className="pane-symbol-dropdown-wrap">
            <button
              className="pane-symbol-trigger"
              onClick={() => setShowSymbolMenu((v) => !v)}
              title="Change currency pair"
            >
              <span className={`status-indicator-dot ${status}`} />
              <div className="symbol-details">
                <span className="symbol-title">{selectedSymbol.display_name}</span>
                <span className="symbol-tag">{symbol}</span>
              </div>
              <ChevronDown size={14} className={showSymbolMenu ? 'rotated' : ''} />
            </button>

            {showSymbolMenu && (
              <div className="pane-symbol-menu">
                <div className="symbol-search-box">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search pair e.g. EUR, USD..."
                    autoFocus
                  />
                </div>
                <div className="menu-group-label">CURRENCY PAIRS / FOREX</div>
                <div className="symbol-menu-list">
                  {filteredSymbols.map((item) => (
                    <button
                      key={item.symbol}
                      className={`symbol-item ${item.symbol === symbol ? 'selected' : ''}`}
                      onClick={() => {
                        setSymbol(item.symbol);
                        setShowSymbolMenu(false);
                        setSearchQuery('');
                      }}
                    >
                      <span className="symbol-item-name">{item.display_name}</span>
                      <span className="symbol-item-code">{item.symbol}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {activeAnalysis?.primaryRange && (
            <div
              className={`pane-range-pill ${activeAnalysis.primaryRange.breakoutState}`}
              title={activeAnalysis.primaryRange.summary}
            >
              {activeAnalysis.primaryRange.breakoutState === 'bullish_confirmed' ? '▲ BULL BREAK (3/3)' :
               activeAnalysis.primaryRange.breakoutState === 'bearish_confirmed' ? '▼ BEAR BREAK (3/3)' :
               activeAnalysis.primaryRange.breakoutState === 'bullish_pending' ? '▲ PENDING' :
               activeAnalysis.primaryRange.breakoutState === 'bearish_pending' ? '▼ PENDING' :
               '● RANGE-BOUND'}
            </div>
          )}
        </div>

        {/* Live Price and Change */}
        <div className="pane-price-wrap">
          <span className="pane-price">{priceText}</span>
          <span className={`pane-change ${change === null ? '' : change >= 0 ? 'positive' : 'negative'}`}>
            {change !== null && change >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {changeText}
          </span>
        </div>

        {/* Timeframe Switcher for this pane */}
        <div className="pane-timeframe-wrap">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.seconds}
              className={`time-btn ${tf.seconds === timeframe.seconds ? 'active' : ''}`}
              onClick={() => setTimeframe(tf)}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Pane Action Buttons */}
        <div className="pane-actions">
          <button
            className="pane-icon-btn"
            onClick={runAnalysis}
            title="Scan Chart Opportunities"
          >
            <Target size={12} />
          </button>
          <button
            className="pane-icon-btn"
            onClick={() => connect(appId, symbol, timeframe.seconds)}
            title="Refresh stream"
          >
            <RefreshCw size={12} />
          </button>
          <button
            className="pane-icon-btn"
            onClick={onToggleMaximize}
            title={isMaximized ? 'Restore 4-Grid' : 'Maximize Chart'}
          >
            {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
        </div>
      </div>

      {/* Candlestick Chart Area */}
      <div className="pane-chart-container">
        <div ref={chartHostRef} className="pane-chart-host" />

        {/* Interactive Drawing Canvas Layer (Lines, Rectangles, Fibonacci) */}
        <DrawingCanvas
          chart={chartApi}
          series={seriesApi}
          candles={candles}
          timeframeSeconds={timeframe.seconds}
          precision={precision}
          activeTool={activeTool}
          onToolUsed={() => setActiveTool('cursor')}
          currentColor={currentColor}
          drawings={drawings}
          onDrawingsChange={handleDrawingsChange}
          selectedId={selectedDrawingId}
          onSelectDrawing={setSelectedDrawingId}
        />

        {/* Floating Trading Drawing Toolbar */}
        <DrawingToolbar
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          currentColor={currentColor}
          onChangeColor={setCurrentColor}
          selectedId={selectedDrawingId}
          onDeleteSelected={handleDeleteSelected}
          onClearAll={handleClearAll}
          drawingsCount={drawings.length}
        />

        {!historyLoaded && (
          <div className="pane-overlay">
            <div className="pane-spinner" />
            <span className="pane-overlay-msg">{message}</span>
            {status === 'error' && (
              <button
                className="pane-retry-btn"
                onClick={() => connect(appId, symbol, timeframe.seconds)}
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      {/* Pane Footer */}
      <div className="pane-footer">
        <span className="pane-status-line">
          <span className={`pane-dot ${status}`} />
          {status === 'live' ? `Live · ${timeframe.label} candles` : message}
        </span>
        <span className="pane-id-tag">CHART {id + 1}</span>
      </div>
    </div>
  );
}

function LiveEATClock() {
  const [eatTime, setEatTime] = useState(getCurrentEATString);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setEatTime(getCurrentEATString());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="eat-clock-badge" title="East African Time (UTC+3)">
      <Clock size={13} className="eat-clock-icon" />
      <span className="eat-clock-time">{eatTime}</span>
      <span className="eat-zone-tag">UTC+3</span>
    </div>
  );
}

export default function App() {
  const [appId, setAppId] = useState(APP_ID_DEFAULT);
  const [appIdDraft, setAppIdDraft] = useState(APP_ID_DEFAULT);
  const [showSettings, setShowSettings] = useState(false);
  const [symbols, setSymbols] = useState<DerivSymbol[]>(FALLBACK_FOREX);
  const [maximizedPane, setMaximizedPane] = useState<number | null>(null);
  const [analysisTriggerSeq, setAnalysisTriggerSeq] = useState(0);
  const [clearAnalysisSeq, setClearAnalysisSeq] = useState(0);
  const [analysisResults, setAnalysisResults] = useState<Record<number, StrategyAnalysisResult>>({});
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const handleTriggerGlobalAnalysis = useCallback(() => {
    setAnalysisTriggerSeq((s) => s + 1);
    setIsDrawerOpen(true);
  }, []);

  const handleAnalysisResult = useCallback((paneId: number, result: StrategyAnalysisResult) => {
    setAnalysisResults((prev) => ({
      ...prev,
      [paneId]: result,
    }));
  }, []);

  const handleClearAnalysisDrawings = useCallback(() => {
    setClearAnalysisSeq((s) => s + 1);
    setAnalysisResults({});
  }, []);

  const confirmedCount = useMemo(() => {
    return Object.values(analysisResults).filter((r) => {
      const s = r.primaryRange?.breakoutState;
      return s === 'bullish_confirmed' || s === 'bearish_confirmed';
    }).length;
  }, [analysisResults]);

  // Default 4 distinct major currency pairs & timeframes
  const initialPanes = useMemo(() => [
    { id: 0, initialSymbol: 'frxEURUSD', initialTimeframe: TIMEFRAMES[0] }, // EUR/USD 1m
    { id: 1, initialSymbol: 'frxGBPUSD', initialTimeframe: TIMEFRAMES[1] }, // GBP/USD 5m
    { id: 2, initialSymbol: 'frxUSDJPY', initialTimeframe: TIMEFRAMES[2] }, // USD/JPY 15m
    { id: 3, initialSymbol: 'frxAUDUSD', initialTimeframe: TIMEFRAMES[0] }, // AUD/USD 1m
  ], []);

  // Fetch full active symbol catalog once from Deriv WebSocket
  useEffect(() => {
    const endpoints = getEndpoints(appId);
    let ws: WebSocket;
    try {
      ws = new WebSocket(endpoints[0]);
    } catch {
      return;
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({ active_symbols: 'brief' }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (Array.isArray(data.active_symbols)) {
          const list: DerivSymbol[] = (data.active_symbols as any[])
            .map((item) => ({
              symbol: item.symbol ?? item.underlying_symbol ?? '',
              display_name: item.display_name ?? item.underlying_symbol_name ?? item.symbol ?? '',
              market: item.market,
              submarket: item.submarket,
            }))
            .filter((item) => item.symbol && item.display_name)
            .sort((a, b) => {
              // Place currency pairs/forex first
              const aForex = a.market === 'forex' || a.symbol.startsWith('frx');
              const bForex = b.market === 'forex' || b.symbol.startsWith('frx');
              if (aForex && !bForex) return -1;
              if (!aForex && bForex) return 1;
              return a.display_name.localeCompare(b.display_name);
            });
          if (list.length) setSymbols(list);
          ws.close();
        }
      } catch {
        // ignore
      }
    };

    return () => {
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [appId]);

  const applyAppId = () => {
    const next = appIdDraft.trim();
    if (next) {
      setAppId(next);
      setShowSettings(false);
    }
  };

  return (
    <main className="app-shell">
      {/* Top Navigation Bar */}
      <header className="topbar">
        <div className="brand-section">
          <div className="brand-mark">
            <Activity size={18} strokeWidth={2.5} />
          </div>
          <div className="brand-text">
            <span className="brand-title">market<span className="brand-accent">desk</span></span>
            <span className="brand-subtitle">FOREX QUAD TERMINAL</span>
          </div>
        </div>

        <div className="topbar-controls">
          {/* Global Strategy Opportunity Detection Action */}
          <button
            className="strategy-scan-btn"
            onClick={handleTriggerGlobalAnalysis}
            title="Scan strategy & highlight ranges across all 4 visible charts"
          >
            <Target size={14} />
            <span>ANALYZE CHARTS</span>
          </button>

          <button
            className="strategy-toggle-drawer-btn"
            onClick={() => setIsDrawerOpen((v) => !v)}
            title="Toggle Opportunity Detection Panel"
          >
            <span>Opportunities</span>
            {confirmedCount > 0 && (
              <span className="strategy-badge-count">{confirmedCount}</span>
            )}
          </button>

          <LiveEATClock />

          <div className="layout-badge">
            <Grid2X2 size={13} />
            <span>4-CHART MULTI-VIEW</span>
          </div>

          <button
            className="icon-button"
            onClick={() => {
              setAppIdDraft(appId);
              setShowSettings((v) => !v);
            }}
            title="Deriv API Settings"
            aria-label="Settings"
          >
            <Settings2 size={16} />
          </button>
        </div>
      </header>

      {/* Opportunity Detection Drawer */}
      <OpportunityDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        results={analysisResults}
        onClearAnalysisDrawings={handleClearAnalysisDrawings}
      />

      {/* Settings Modal / Drawer */}
      {showSettings && (
        <section className="settings-panel">
          <div className="settings-copy">
            <strong>Deriv API Configuration</strong>
            <span>Deriv market data and OHLC candlestick streams are public. You can connect your registered app ID.</span>
          </div>
          <div className="settings-form">
            <input
              value={appIdDraft}
              onChange={(e) => setAppIdDraft(e.target.value)}
              placeholder="Deriv Application ID"
              aria-label="Deriv Application ID"
            />
            <button className="primary-button" onClick={applyAppId}>Save & Connect</button>
          </div>
          <a
            className="help-link"
            href="https://developers.deriv.com/docs/intro/api-overview/"
            target="_blank"
            rel="noreferrer"
          >
            <CircleHelp size={14} /> Deriv API Documentation
          </a>
        </section>
      )}

      {/* Quad Multi-Chart Grid (2x2) */}
      <section className={`quad-grid ${maximizedPane !== null ? 'has-maximized' : ''}`}>
        {initialPanes.map((pane) => {
          const isMaximized = maximizedPane === pane.id;
          if (maximizedPane !== null && !isMaximized) {
            return null;
          }
          return (
            <ChartPane
              key={pane.id}
              id={pane.id}
              appId={appId}
              initialSymbol={pane.initialSymbol}
              initialTimeframe={pane.initialTimeframe}
              symbols={symbols}
              isMaximized={isMaximized}
              onToggleMaximize={() => setMaximizedPane(isMaximized ? null : pane.id)}
              analysisTriggerSeq={analysisTriggerSeq}
              clearAnalysisSeq={clearAnalysisSeq}
              onAnalysisResult={handleAnalysisResult}
            />
          );
        })}
      </section>

      {/* Footer info bar */}
      <footer className="page-footer">
        <div className="footer-left-info">
          <span>LIVE FOREX STREAMS</span>
          <span className="dot-sep">·</span>
          <span>4 INDEPENDENT CURRENCY & TIMEFRAME ENGINES</span>
          <span className="dot-sep">·</span>
          <span>WSS://API.DERIVWS.COM</span>
        </div>
        <span>All times strictly displayed in East Africa Time (EAT · UTC+3)</span>
      </footer>
    </main>
  );
}
import React from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Layers,
  TrendingUp,
  TrendingDown,
  X,
  Target,
} from 'lucide-react';
import type { StrategyAnalysisResult, DetectedRange } from '../strategy/types';

interface OpportunityDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  results: Record<number, StrategyAnalysisResult>;
  onApplyRangeToChart?: (paneId: number, range: DetectedRange) => void;
  onClearAnalysisDrawings?: () => void;
}

export const OpportunityDrawer: React.FC<OpportunityDrawerProps> = ({
  isOpen,
  onClose,
  results,
  onClearAnalysisDrawings,
}) => {
  if (!isOpen) return null;

  const entries = Object.entries(results);

  return (
    <aside className="opportunity-drawer" aria-label="Strategy Opportunity Detection Panel">
      <div className="drawer-header">
        <div className="drawer-title-area">
          <div className="drawer-icon-wrap">
            <Target size={18} className="text-accent" />
          </div>
          <div>
            <h2 className="drawer-title">Strategy Analysis Engine</h2>
            <p className="drawer-subtitle">
              Multi-chart opportunity detection · Range boundaries & 3-close breakout confirmation
            </p>
          </div>
        </div>
        <div className="drawer-actions">
          {onClearAnalysisDrawings && (
            <button
              className="drawer-clear-btn"
              onClick={onClearAnalysisDrawings}
              title="Remove automatically plotted ranges from charts"
            >
              Clear Auto Ranges
            </button>
          )}
          <button className="drawer-close-btn" onClick={onClose} aria-label="Close drawer">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="drawer-body">
        {entries.length === 0 ? (
          <div className="drawer-empty-state">
            <Layers size={36} className="text-muted" />
            <p>No analysis run yet. Click <strong>Analyze Visible Charts</strong> to scan market structure.</p>
          </div>
        ) : (
          entries.map(([paneIdStr, res]) => {
            const paneId = Number(paneIdStr);
            const range = res.primaryRange;
            const isConfirmed =
              range?.breakoutState === 'bullish_confirmed' ||
              range?.breakoutState === 'bearish_confirmed';
            const isPending =
              range?.breakoutState === 'bullish_pending' ||
              range?.breakoutState === 'bearish_pending';

            return (
              <div key={paneId} className={`opportunity-card ${range ? range.breakoutState : 'no-range'}`}>
                {/* Card Header */}
                <div className="card-top-bar">
                  <div className="card-pair-badge">
                    <span className="card-symbol">{res.symbol}</span>
                    <span className="card-tf-pill">{res.timeframeLabel}</span>
                    <span className="card-bars-tag">{res.lookbackCandles} bars inspected</span>
                  </div>

                  <div className="card-status-pill">
                    {isConfirmed && (
                      <span className="pill-confirmed">
                        <ShieldCheck size={13} />
                        CONFIRMED BREAKOUT
                      </span>
                    )}
                    {isPending && (
                      <span className="pill-pending">
                        <AlertTriangle size={13} />
                        BREAKOUT DEVELOPING ({range?.consecutiveCloses}/{range?.requiredCloses})
                      </span>
                    )}
                    {range && !isConfirmed && !isPending && (
                      <span className="pill-inside">
                        <Layers size={13} />
                        RANGE-BOUND
                      </span>
                    )}
                    {!range && <span className="pill-trending">TRENDING / OPEN</span>}
                  </div>
                </div>

                {/* Range Details */}
                {range ? (
                  <div className="card-metrics-grid">
                    <div className="metric-box">
                      <span className="metric-label">Upper Ceiling (Avg Highs)</span>
                      <span className="metric-value">{range.upperBoundary.toFixed(5)}</span>
                      <span className="metric-sub">{range.swingHighs.length} touches</span>
                    </div>

                    <div className="metric-box">
                      <span className="metric-label">Lower Floor (Avg Lows)</span>
                      <span className="metric-value">{range.lowerBoundary.toFixed(5)}</span>
                      <span className="metric-sub">{range.swingLows.length} touches</span>
                    </div>

                    <div className="metric-box">
                      <span className="metric-label">Range Height</span>
                      <span className="metric-value highlight">{range.heightPips} pips</span>
                      <span className="metric-sub">{range.candleCount} bars span</span>
                    </div>

                    <div className="metric-box">
                      <span className="metric-label">Consecutive Closes</span>
                      <span className="metric-value">
                        {range.consecutiveCloses} / {range.requiredCloses}
                      </span>
                      <span className="metric-sub">
                        {range.consecutiveCloses >= 3 ? 'Rule Met' : 'Filter Active'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="no-range-banner">
                    <p>{res.statusMessage}</p>
                  </div>
                )}

                {/* Strategy Recommendation Note */}
                {range && (
                  <div className="recommendation-box">
                    <div className="rec-header">
                      {range.breakoutState === 'bullish_confirmed' ? (
                        <TrendingUp size={14} className="text-bullish" />
                      ) : range.breakoutState === 'bearish_confirmed' ? (
                        <TrendingDown size={14} className="text-bearish" />
                      ) : (
                        <AlertTriangle size={14} className="text-amber" />
                      )}
                      <strong>STRATEGY RECOMMENDATION</strong>
                    </div>
                    <p className="rec-text">{range.recommendation}</p>
                  </div>
                )}

                {/* FVGs if any unmitigated */}
                {res.unmitigatedFVGs.length > 0 && (
                  <div className="fvg-chips-row">
                    <span className="fvg-label">Strategy A (Active FVGs):</span>
                    {res.unmitigatedFVGs.map((fvg) => (
                      <span key={fvg.id} className={`fvg-chip ${fvg.type}`}>
                        {fvg.type === 'bullish' ? '▲ Bullish FVG' : '▼ Bearish FVG'} [
                        {fvg.bottom.toFixed(5)} - {fvg.top.toFixed(5)}]
                      </span>
                    ))}
                  </div>
                )}

                {/* Key Reversal Levels (HTF averages of highs/lows + Fib confirmed) */}
                {res.keyLevels && res.keyLevels.length > 0 && (
                  <div className="key-levels-row">
                    <span className="key-levels-label">Reversals (HTF/Fib):</span>
                    {res.keyLevels.slice(0, 4).map((kl) => (
                      <span
                        key={kl.id}
                        className={`key-level-chip ${kl.type} ${kl.fibAligned ? 'fib-tagged' : ''}`}
                        title={`${kl.strength} touches · ${kl.fibAligned ? 'Fibonacci aligned' : 'Swing average'}`}
                      >
                        {kl.type === 'resistance' ? 'Rev Res' : 'Rev Sup'} {kl.price.toFixed(5)}
                        {kl.fibAligned && <span className="fib-badge">Fib</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};

import React from 'react';
import { MousePointer, Minus, Square, Percent, Trash2, Palette } from 'lucide-react';
import { type ActiveTool, DRAWING_COLORS } from './types';

interface DrawingToolbarProps {
  activeTool: ActiveTool;
  onSelectTool: (tool: ActiveTool) => void;
  currentColor: string;
  onChangeColor: (color: string) => void;
  selectedId: string | null;
  onDeleteSelected: () => void;
  onClearAll: () => void;
  drawingsCount: number;
}

export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({
  activeTool,
  onSelectTool,
  currentColor,
  onChangeColor,
  selectedId,
  onDeleteSelected,
  onClearAll,
  drawingsCount,
}) => {
  const [showColorPicker, setShowColorPicker] = React.useState(false);

  return (
    <div className="drawing-toolbar" onClick={(e) => e.stopPropagation()}>
      <div className="drawing-tool-group">
        <button
          type="button"
          className={`drawing-btn ${activeTool === 'cursor' ? 'active' : ''}`}
          onClick={() => onSelectTool('cursor')}
          title="Pointer / Select & Move (V)"
          aria-label="Cursor"
        >
          <MousePointer size={13} />
        </button>

        <button
          type="button"
          className={`drawing-btn ${activeTool === 'line' ? 'active' : ''}`}
          onClick={() => onSelectTool('line')}
          title="Trendline / Line (L)"
          aria-label="Line Tool"
        >
          <Minus size={13} style={{ transform: 'rotate(-45deg)' }} />
        </button>

        <button
          type="button"
          className={`drawing-btn ${activeTool === 'rectangle' ? 'active' : ''}`}
          onClick={() => onSelectTool('rectangle')}
          title="Rectangle / S&R Zone (R)"
          aria-label="Rectangle Tool"
        >
          <Square size={13} />
        </button>

        <button
          type="button"
          className={`drawing-btn ${activeTool === 'fibonacci' ? 'active' : ''}`}
          onClick={() => onSelectTool('fibonacci')}
          title="Fibonacci Retracement (F)"
          aria-label="Fibonacci Tool"
        >
          <Percent size={13} />
        </button>
      </div>

      <div className="drawing-toolbar-divider" />

      {/* Color Picker */}
      <div className="drawing-color-container">
        <button
          type="button"
          className="drawing-btn color-trigger-btn"
          onClick={() => setShowColorPicker((v) => !v)}
          title="Drawing Color"
          aria-label="Drawing Color"
        >
          <span className="color-preview-dot" style={{ backgroundColor: currentColor }} />
          <Palette size={11} className="palette-icon" />
        </button>

        {showColorPicker && (
          <div className="drawing-color-menu">
            {DRAWING_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-choice-btn ${currentColor === c ? 'selected' : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => {
                  onChangeColor(c);
                  setShowColorPicker(false);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Delete actions */}
      {selectedId && (
        <button
          type="button"
          className="drawing-btn delete-btn"
          onClick={onDeleteSelected}
          title="Delete selected drawing (Del/Backspace)"
          aria-label="Delete selected"
        >
          <Trash2 size={13} color="#f0526b" />
        </button>
      )}

      {drawingsCount > 0 && !selectedId && (
        <button
          type="button"
          className="drawing-btn clear-btn"
          onClick={onClearAll}
          title={`Clear all ${drawingsCount} drawings`}
          aria-label="Clear all drawings"
        >
          <Trash2 size={12} />
          <span className="drawings-badge">{drawingsCount}</span>
        </button>
      )}
    </div>
  );
};

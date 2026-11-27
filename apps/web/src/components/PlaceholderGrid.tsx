import { useRef, useState, type KeyboardEvent } from 'react';
import {
  CELL_COUNT,
  GRID_SIZE,
  getCellCoords,
  getCellIndex,
  getHighlightKind,
  moveSelection,
} from '../grid/gridMath';

const ROW_INDICES = Array.from({ length: GRID_SIZE }, (_, row) => row);
const COL_INDICES = Array.from({ length: GRID_SIZE }, (_, col) => col);
const INNER_LINES = Array.from({ length: GRID_SIZE - 1 }, (_, i) => i + 1);

export function PlaceholderGrid() {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>(
    Array.from({ length: CELL_COUNT }, () => null),
  );

  const selectedCoords = selectedIndex !== null ? getCellCoords(selectedIndex) : null;
  const activeTabIndex = selectedIndex ?? 0;

  function focusCell(index: number) {
    cellRefs.current[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, cellIndex: number) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelectedIndex(cellIndex);
      return;
    }

    const nextIndex = moveSelection(selectedIndex ?? cellIndex, event.key);
    if (nextIndex === selectedIndex && event.key !== 'Escape') {
      return;
    }

    if (
      event.key.startsWith('Arrow') ||
      event.key === 'Home' ||
      event.key === 'End' ||
      event.key === 'PageUp' ||
      event.key === 'PageDown' ||
      event.key === 'Escape'
    ) {
      event.preventDefault();
      setSelectedIndex(nextIndex);
      if (nextIndex !== null) {
        focusCell(nextIndex);
      }
    }
  }

  return (
    <section className="hs-board-section" aria-label="Placeholder Sudoku board">
      <div className="hs-board-header">
        <p className="hs-board-status" aria-live="polite">
          {selectedCoords
            ? `Selected: Row ${selectedCoords.row + 1}, Column ${selectedCoords.col + 1} (Box ${selectedCoords.box + 1})`
            : 'Select any cell using touch, mouse, or arrow keys.'}
        </p>
        {selectedIndex !== null ? (
          <button
            type="button"
            className="hs-btn hs-btn-secondary"
            onClick={() => setSelectedIndex(null)}
          >
            Clear selection
          </button>
        ) : null}
      </div>

      <div className="hs-board-frame">
        <div className="hs-grid" role="grid" aria-label="9 by 9 Sudoku placeholder grid">
          {ROW_INDICES.map((row) => (
            <div key={row} className="hs-grid-row" role="row">
              {COL_INDICES.map((col) => {
                const index = getCellIndex(row, col);
                const highlight = getHighlightKind(selectedIndex, index);
                const isSelected = highlight === 'selected';

                return (
                  <button
                    key={index}
                    ref={(el) => {
                      cellRefs.current[index] = el;
                    }}
                    type="button"
                    role="gridcell"
                    className="hs-cell"
                    data-highlight={highlight}
                    data-row={row}
                    data-col={col}
                    aria-selected={isSelected}
                    aria-label={`Row ${row + 1}, Column ${col + 1}${isSelected ? ', selected' : ''}`}
                    tabIndex={index === activeTabIndex ? 0 : -1}
                    onClick={() => setSelectedIndex(index)}
                    onKeyDown={(event) => handleKeyDown(event, index)}
                  >
                    {isSelected ? (
                      <span className="hs-cell-selected-marker" aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <svg
          className="hs-grid-lines"
          viewBox="0 0 900 900"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {INNER_LINES.map((n) => {
            const pos = n * 100;
            const isBoxBoundary = n % 3 === 0;
            const className = isBoxBoundary ? 'hs-line-box' : 'hs-line-cell';
            return (
              <g key={n}>
                <line x1={pos} y1={0} x2={pos} y2={900} className={className} />
                <line x1={0} y1={pos} x2={900} y2={pos} className={className} />
              </g>
            );
          })}
          <rect x={1} y={1} width={898} height={898} fill="none" className="hs-line-outer" />
        </svg>
      </div>
    </section>
  );
}

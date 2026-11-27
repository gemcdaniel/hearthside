import { useRef, useState, type KeyboardEvent } from 'react';
import {
  CELL_COUNT,
  GRID_SIZE,
  getCellCoords,
  getCellIndex,
  getHighlightKind,
  moveSelection,
} from '../grid/gridMath';

const CELL_INDICES = Array.from({ length: CELL_COUNT }, (_, i) => i);
const THIN_LINE_POSITIONS = [100, 200, 400, 500, 700, 800] as const;
const BOX_LINE_POSITIONS = [300, 600] as const;

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
            : 'Select any cell using touch, mouse, stylus, or arrow keys.'}
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
        <div className="hs-board-stage">
          <div
            className="hs-grid"
            role="grid"
            aria-label="9 by 9 Sudoku placeholder grid"
            aria-rowcount={GRID_SIZE}
            aria-colcount={GRID_SIZE}
          >
            {CELL_INDICES.map((index) => {
              const { row, col } = getCellCoords(index);
              const cellId = getCellIndex(row, col);
              const highlight = getHighlightKind(selectedIndex, cellId);
              const isSelected = highlight === 'selected';

              return (
                <button
                  key={cellId}
                  ref={(el) => {
                    cellRefs.current[cellId] = el;
                  }}
                  type="button"
                  role="gridcell"
                  className="hs-cell"
                  data-highlight={highlight}
                  data-row={row}
                  data-col={col}
                  aria-rowindex={row + 1}
                  aria-colindex={col + 1}
                  aria-selected={isSelected}
                  aria-label={`Row ${row + 1}, Column ${col + 1}${isSelected ? ', selected' : ''}`}
                  tabIndex={cellId === activeTabIndex ? 0 : -1}
                  onClick={() => setSelectedIndex(cellId)}
                  onKeyDown={(event) => handleKeyDown(event, cellId)}
                >
                  {isSelected ? (
                    <span className="hs-cell-selected-marker" aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
          </div>

          <svg
            className="hs-grid-lines"
            data-testid="grid-lines-svg"
            viewBox="0 0 900 900"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <g data-line-group="cell">
              {THIN_LINE_POSITIONS.map((pos) => (
                <line
                  key={`v-cell-${pos}`}
                  x1={pos}
                  y1={0}
                  x2={pos}
                  y2={900}
                  className="hs-line-cell"
                  data-line-kind="cell"
                />
              ))}
              {THIN_LINE_POSITIONS.map((pos) => (
                <line
                  key={`h-cell-${pos}`}
                  x1={0}
                  y1={pos}
                  x2={900}
                  y2={pos}
                  className="hs-line-cell"
                  data-line-kind="cell"
                />
              ))}
            </g>
            <g data-line-group="box">
              {BOX_LINE_POSITIONS.map((pos) => (
                <line
                  key={`v-box-${pos}`}
                  x1={pos}
                  y1={0}
                  x2={pos}
                  y2={900}
                  className="hs-line-box"
                  data-line-kind="box"
                />
              ))}
              {BOX_LINE_POSITIONS.map((pos) => (
                <line
                  key={`h-box-${pos}`}
                  x1={0}
                  y1={pos}
                  x2={900}
                  y2={pos}
                  className="hs-line-box"
                  data-line-kind="box"
                />
              ))}
            </g>
          </svg>
        </div>
      </div>
    </section>
  );
}

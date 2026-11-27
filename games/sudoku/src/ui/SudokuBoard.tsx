import type { ReactNode } from 'react';
import { BOARD_SIZE, COL_OF, GRID_SIZE, ROW_OF, hasDigitBit } from '../engine/boardMath';
import {
  getDuplicateConflicts,
  getHighlightMap,
  getVisibleNotes,
  getWrongValueCells,
} from '../engine/selectors';
import type { SudokuState } from '../engine/types';

const CELL_INDICES = Array.from({ length: BOARD_SIZE }, (_, i) => i);
const NOTE_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const THIN_LINE_POSITIONS = [100, 200, 400, 500, 700, 800] as const;
const BOX_LINE_POSITIONS = [300, 600] as const;

export interface SudokuBoardProps {
  readonly state: SudokuState;
  readonly flagDuplicateConflicts: boolean;
  readonly flagWrongValues: boolean;
  readonly onSelectCell: (cell: number) => void;
  readonly onResume: () => void;
  readonly stageOverlay?: ReactNode;
}

export function SudokuBoard({
  state,
  flagDuplicateConflicts,
  flagWrongValues,
  onSelectCell,
  onResume,
  stageOverlay,
}: SudokuBoardProps) {
  const highlights = getHighlightMap(state);
  const peerSet = new Set(highlights.peers);
  const sameDigitSet = new Set(highlights.sameDigit);

  const conflictSet = flagDuplicateConflicts
    ? new Set(getDuplicateConflicts(state.cells))
    : new Set<number>();

  const wrongSet = new Set<number>(state.checkedWrongCells);
  if (flagWrongValues) {
    for (const idx of getWrongValueCells(state.cells, state.puzzle.solution)) {
      wrongSet.add(idx);
    }
  }

  const selectedCellObj = state.selectedCell !== null ? state.cells[state.selectedCell] : undefined;
  const selectedDigit = selectedCellObj?.value ?? 0;
  const activeTabIndex = state.selectedCell ?? 0;

  return (
    <div className="hs-sudoku-frame">
      <div className="hs-sudoku-stage">
        <div
          className="hs-sudoku-grid"
          role="grid"
          aria-label="9 by 9 Sudoku board"
          aria-rowcount={GRID_SIZE}
          aria-colcount={GRID_SIZE}
          data-autoshow={state.autoShowEnabled ? 'true' : 'false'}
        >
          {CELL_INDICES.map((idx) => {
            const cell = state.cells[idx];
            if (!cell) {
              return null;
            }
            const row = ROW_OF[idx] ?? 0;
            const col = COL_OF[idx] ?? 0;
            const isSelected = highlights.selected === idx;
            const isSameDigit = sameDigitSet.has(idx);
            const isPeer = peerSet.has(idx);
            const highlightKind = isSelected
              ? 'selected'
              : isSameDigit
                ? 'same-digit'
                : isPeer
                  ? 'peer'
                  : 'none';

            const isConflict = !state.paused && conflictSet.has(idx);
            const isWrong = !state.paused && wrongSet.has(idx);
            const visibleNotesMask = state.paused ? 0 : getVisibleNotes(state, idx);

            const ariaParts = [`Row ${row + 1}, Column ${col + 1}`];
            if (!state.paused) {
              if (cell.value !== 0) {
                ariaParts.push(`${cell.given ? 'given ' : ''}${cell.value}`);
              } else {
                ariaParts.push('empty');
              }
              if (isConflict) ariaParts.push('conflict');
              if (isWrong) ariaParts.push('wrong value');
            }
            if (isSelected) ariaParts.push('selected');

            return (
              <button
                key={idx}
                type="button"
                role="gridcell"
                className="hs-sudoku-cell"
                data-highlight={highlightKind}
                data-given={cell.given ? 'true' : 'false'}
                data-conflict={isConflict ? 'true' : 'false'}
                data-wrong={isWrong ? 'true' : 'false'}
                data-autoshow={state.autoShowEnabled ? 'true' : 'false'}
                data-row={row}
                data-col={col}
                aria-rowindex={row + 1}
                aria-colindex={col + 1}
                aria-selected={isSelected}
                aria-label={ariaParts.join(', ')}
                tabIndex={idx === activeTabIndex ? 0 : -1}
                onPointerDown={() => onSelectCell(idx)}
                onClick={() => onSelectCell(idx)}
              >
                {!state.paused && cell.value !== 0 ? (
                  <span className="hs-sudoku-digit">{cell.value}</span>
                ) : null}

                {!state.paused && cell.value === 0 && visibleNotesMask !== 0 ? (
                  <span className="hs-sudoku-notes" aria-hidden="true">
                    {NOTE_DIGITS.map((digit) => {
                      const shown = hasDigitBit(visibleNotesMask, digit);
                      const matchesSelectedDigit = shown && selectedDigit === digit;
                      return (
                        <span
                          key={digit}
                          className="hs-sudoku-note"
                          data-note-digit={digit}
                          data-active={shown ? 'true' : 'false'}
                          data-note-match={matchesSelectedDigit ? 'true' : 'false'}
                        >
                          {shown ? digit : ''}
                        </span>
                      );
                    })}
                  </span>
                ) : null}

                {isConflict ? (
                  <span className="hs-cell-flag hs-cell-flag-conflict" aria-hidden="true">
                    !
                  </span>
                ) : isWrong ? (
                  <span className="hs-cell-flag hs-cell-flag-wrong" aria-hidden="true">
                    ×
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <svg
          className="hs-sudoku-grid-lines"
          data-testid="sudoku-grid-lines-svg"
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
                className="hs-sudoku-line-cell"
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
                className="hs-sudoku-line-cell"
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
                className="hs-sudoku-line-box"
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
                className="hs-sudoku-line-box"
                data-line-kind="box"
              />
            ))}
          </g>
        </svg>

        {state.paused ? (
          <div
            className="hs-sudoku-curtain"
            data-testid="pause-curtain"
            role="region"
            aria-label="Game paused"
          >
            <p className="hs-sudoku-curtain-title">Game Paused</p>
            <p className="hs-sudoku-curtain-subtitle">
              Board hidden and timer stopped while paused.
            </p>
            <button type="button" className="hs-btn hs-btn-primary" onClick={onResume}>
              Resume Game
            </button>
          </div>
        ) : null}

        {stageOverlay ?? null}
      </div>
    </div>
  );
}

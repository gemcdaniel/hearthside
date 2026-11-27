import {
  ALL_DIGITS_MASK,
  BOXES,
  BOX_OF,
  COLS,
  COL_OF,
  GRID_SIZE,
  ROWS,
  ROW_OF,
  digitBit,
  isValidCellIndex,
} from './boardMath';
import type { SudokuCell } from './types';

export interface NewlyCompletedUnits {
  readonly rows: readonly number[];
  readonly cols: readonly number[];
  readonly boxes: readonly number[];
  readonly cells: readonly number[];
  readonly delayByCell: Readonly<Record<number, number>>;
}

const EMPTY_RESULT: NewlyCompletedUnits = {
  rows: [],
  cols: [],
  boxes: [],
  cells: [],
  delayByCell: {},
};

const SWEEP_STEP_DELAY_MS = 22;

/**
 * Returns true iff all 9 cells in a row, column, or box hold digits 1..9 with zero duplicates.
 * Deliberately ignores puzzle.solution so unflagged wrong values in adult mode never leak.
 */
export function isUnitComplete(
  cells: readonly SudokuCell[],
  unitCells: readonly number[],
): boolean {
  if (unitCells.length !== GRID_SIZE) {
    return false;
  }
  let mask = 0;
  for (const idx of unitCells) {
    const val = cells[idx]?.value ?? 0;
    if (val < 1 || val > GRID_SIZE) {
      return false;
    }
    mask |= digitBit(val);
  }
  return mask === ALL_DIGITS_MASK;
}

/**
 * Detects rows, columns, and 3x3 boxes newly completed by placing digits in `placedCells`.
 */
export function detectNewlyCompletedUnits(
  prevCells: readonly SudokuCell[],
  nextCells: readonly SudokuCell[],
  placedCells: readonly number[],
): NewlyCompletedUnits {
  const validSources = placedCells.filter((cellIdx) => {
    if (!isValidCellIndex(cellIdx)) {
      return false;
    }
    const nextVal = nextCells[cellIdx]?.value ?? 0;
    return nextVal >= 1 && nextVal <= GRID_SIZE;
  });

  if (validSources.length === 0) {
    return EMPTY_RESULT;
  }

  const candidateRows = new Set<number>();
  const candidateCols = new Set<number>();
  const candidateBoxes = new Set<number>();

  for (const cellIdx of validSources) {
    candidateRows.add(ROW_OF[cellIdx] ?? 0);
    candidateCols.add(COL_OF[cellIdx] ?? 0);
    candidateBoxes.add(BOX_OF[cellIdx] ?? 0);
  }

  const rows: number[] = [];
  const cols: number[] = [];
  const boxes: number[] = [];
  const cellSet = new Set<number>();

  for (const r of candidateRows) {
    const unit = ROWS[r];
    if (unit && !isUnitComplete(prevCells, unit) && isUnitComplete(nextCells, unit)) {
      rows.push(r);
      for (const c of unit) cellSet.add(c);
    }
  }

  for (const c of candidateCols) {
    const unit = COLS[c];
    if (unit && !isUnitComplete(prevCells, unit) && isUnitComplete(nextCells, unit)) {
      cols.push(c);
      for (const idx of unit) cellSet.add(idx);
    }
  }

  for (const b of candidateBoxes) {
    const unit = BOXES[b];
    if (unit && !isUnitComplete(prevCells, unit) && isUnitComplete(nextCells, unit)) {
      boxes.push(b);
      for (const idx of unit) cellSet.add(idx);
    }
  }

  if (cellSet.size === 0) {
    return EMPTY_RESULT;
  }

  const completedCells = Array.from(cellSet).sort((a, b) => a - b);
  const delayByCell: Record<number, number> = {};

  for (const cellIdx of completedCells) {
    const targetRow = ROW_OF[cellIdx] ?? 0;
    const targetCol = COL_OF[cellIdx] ?? 0;
    let minDistance = Number.POSITIVE_INFINITY;
    for (const srcIdx of validSources) {
      const dist =
        Math.abs(targetRow - (ROW_OF[srcIdx] ?? 0)) +
        Math.abs(targetCol - (COL_OF[srcIdx] ?? 0));
      if (dist < minDistance) {
        minDistance = dist;
      }
    }
    delayByCell[cellIdx] = minDistance * SWEEP_STEP_DELAY_MS;
  }

  return {
    rows,
    cols,
    boxes,
    cells: completedCells,
    delayByCell,
  };
}

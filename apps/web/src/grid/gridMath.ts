export const GRID_SIZE = 9;
export const BOX_SIZE = 3;
export const CELL_COUNT = GRID_SIZE * GRID_SIZE;

export interface CellCoords {
  readonly row: number;
  readonly col: number;
  readonly box: number;
}

export type HighlightKind = 'selected' | 'peer' | 'none';

export function getCellCoords(index: number): CellCoords {
  if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT) {
    throw new RangeError(`Cell index out of range: ${index}`);
  }
  const row = Math.floor(index / GRID_SIZE);
  const col = index % GRID_SIZE;
  const box = Math.floor(row / BOX_SIZE) * BOX_SIZE + Math.floor(col / BOX_SIZE);
  return { row, col, box };
}

export function getCellIndex(row: number, col: number): number {
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row >= GRID_SIZE ||
    col < 0 ||
    col >= GRID_SIZE
  ) {
    throw new RangeError(`Cell coordinates out of range: (${row}, ${col})`);
  }
  return row * GRID_SIZE + col;
}

export function isPeerCell(selectedIndex: number | null, cellIndex: number): boolean {
  if (selectedIndex === null || selectedIndex === cellIndex) {
    return false;
  }
  const selected = getCellCoords(selectedIndex);
  const cell = getCellCoords(cellIndex);
  return selected.row === cell.row || selected.col === cell.col || selected.box === cell.box;
}

export function getHighlightKind(selectedIndex: number | null, cellIndex: number): HighlightKind {
  if (selectedIndex === null) {
    return 'none';
  }
  if (selectedIndex === cellIndex) {
    return 'selected';
  }
  return isPeerCell(selectedIndex, cellIndex) ? 'peer' : 'none';
}

export function moveSelection(currentIndex: number | null, key: string): number | null {
  if (key === 'Escape') {
    return null;
  }

  const activeIndex = currentIndex ?? 0;
  const { row, col } = getCellCoords(activeIndex);

  switch (key) {
    case 'ArrowUp':
      return getCellIndex(Math.max(0, row - 1), col);
    case 'ArrowDown':
      return getCellIndex(Math.min(GRID_SIZE - 1, row + 1), col);
    case 'ArrowLeft':
      return getCellIndex(row, Math.max(0, col - 1));
    case 'ArrowRight':
      return getCellIndex(row, Math.min(GRID_SIZE - 1, col + 1));
    case 'Home':
      return getCellIndex(row, 0);
    case 'End':
      return getCellIndex(row, GRID_SIZE - 1);
    case 'PageUp':
      return getCellIndex(0, col);
    case 'PageDown':
      return getCellIndex(GRID_SIZE - 1, col);
    default:
      return currentIndex;
  }
}

import { describe, expect, it } from 'vitest';
import {
  CELL_COUNT,
  getCellCoords,
  getCellIndex,
  getHighlightKind,
  isPeerCell,
  moveSelection,
} from './gridMath';

describe('gridMath', () => {
  it('maps cell indices to row, col, and 3x3 box coordinates', () => {
    expect(getCellCoords(0)).toEqual({ row: 0, col: 0, box: 0 });
    expect(getCellCoords(40)).toEqual({ row: 4, col: 4, box: 4 });
    expect(getCellCoords(80)).toEqual({ row: 8, col: 8, box: 8 });
    expect(getCellIndex(4, 4)).toBe(40);
  });

  it('identifies the exact 20 row, column, and box peers for any selected cell', () => {
    const selected = getCellIndex(4, 4);
    let peerCount = 0;

    for (let i = 0; i < CELL_COUNT; i += 1) {
      if (isPeerCell(selected, i)) {
        peerCount += 1;
        expect(getHighlightKind(selected, i)).toBe('peer');
      }
    }

    expect(peerCount).toBe(20);
    expect(getHighlightKind(selected, selected)).toBe('selected');
    expect(getHighlightKind(selected, getCellIndex(0, 0))).toBe('none');
    expect(getHighlightKind(null, selected)).toBe('none');
  });

  it('moves selection with arrow keys, Home/End/Page keys, and Escape', () => {
    const start = getCellIndex(4, 4);
    expect(moveSelection(start, 'ArrowUp')).toBe(getCellIndex(3, 4));
    expect(moveSelection(start, 'ArrowDown')).toBe(getCellIndex(5, 4));
    expect(moveSelection(start, 'ArrowLeft')).toBe(getCellIndex(4, 3));
    expect(moveSelection(start, 'ArrowRight')).toBe(getCellIndex(4, 5));
    expect(moveSelection(start, 'Home')).toBe(getCellIndex(4, 0));
    expect(moveSelection(start, 'End')).toBe(getCellIndex(4, 8));
    expect(moveSelection(start, 'PageUp')).toBe(getCellIndex(0, 4));
    expect(moveSelection(start, 'PageDown')).toBe(getCellIndex(8, 4));
    expect(moveSelection(start, 'Escape')).toBeNull();

    // Clamps at grid edges
    expect(moveSelection(getCellIndex(0, 0), 'ArrowUp')).toBe(0);
    expect(moveSelection(getCellIndex(0, 0), 'ArrowLeft')).toBe(0);
    expect(moveSelection(getCellIndex(8, 8), 'ArrowDown')).toBe(80);
    expect(moveSelection(getCellIndex(8, 8), 'ArrowRight')).toBe(80);
  });
});

import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, BOXES, COLS, ROWS } from './boardMath';
import type { SudokuCell } from './types';
import { detectNewlyCompletedUnits, isUnitComplete } from './unitCompletion';

function makeCells(digits: Readonly<Record<number, number>> = {}): SudokuCell[] {
  return Array.from({ length: BOARD_SIZE }, (_, idx) => ({
    value: digits[idx] ?? 0,
    given: false,
    manualNotes: 0,
    autoShowExcluded: 0,
    autoShowAdded: 0,
  }));
}

describe('unitCompletion detector', () => {
  it('detects newly completed row with staggered radial delays', () => {
    const prevMap: Record<number, number> = {};
    const row0 = ROWS[0]!;
    for (let i = 0; i < 8; i += 1) {
      prevMap[row0[i]!] = i + 1;
    }
    const prev = makeCells(prevMap);
    const next = makeCells({ ...prevMap, [row0[8]!]: 9 });

    const result = detectNewlyCompletedUnits(prev, next, [row0[8]!]);
    expect(result.rows).toEqual([0]);
    expect(result.cols).toEqual([]);
    expect(result.boxes).toEqual([]);
    expect(result.cells).toEqual([...row0]);
    expect(result.delayByCell[row0[8]!]).toBe(0);
    expect(result.delayByCell[row0[0]!]).toBeGreaterThan(result.delayByCell[row0[7]!]!);
  });

  it('detects newly completed column and box cleanly', () => {
    const colDigits: Record<number, number> = {};
    const col3 = COLS[3]!;
    for (let i = 0; i < 8; i += 1) {
      colDigits[col3[i]!] = i + 1;
    }
    const colPrev = makeCells(colDigits);
    const colNext = makeCells({ ...colDigits, [col3[8]!]: 9 });
    const colRes = detectNewlyCompletedUnits(colPrev, colNext, [col3[8]!]);
    expect(colRes.cols).toEqual([3]);
    expect(colRes.cells).toEqual([...col3]);

    const boxDigits: Record<number, number> = {};
    const box4 = BOXES[4]!;
    for (let i = 0; i < 8; i += 1) {
      boxDigits[box4[i]!] = i + 1;
    }
    const boxPrev = makeCells(boxDigits);
    const boxNext = makeCells({ ...boxDigits, [box4[8]!]: 9 });
    const boxRes = detectNewlyCompletedUnits(boxPrev, boxNext, [box4[8]!]);
    expect(boxRes.boxes).toEqual([4]);
    expect(boxRes.cells).toEqual([...box4].sort((a, b) => a - b));
  });

  it('handles simultaneous row + col + box completion without duplicate cell entries', () => {
    // Shared pivot cell: index 0 (row 0, col 0, box 0)
    const digits: Record<number, number> = {};
    const expected = new Set<number>([0]);

    const rowOrder = [2, 3, 4, 5, 6, 7, 8, 9];
    ROWS[0]!.filter((c) => c !== 0).forEach((cell, idx) => {
      digits[cell] = rowOrder[idx]!;
      expected.add(cell);
    });

    COLS[0]!.filter((c) => c !== 0).forEach((cell, idx) => {
      digits[cell] = rowOrder[idx]!;
      expected.add(cell);
    });

    // Remaining 4 cells in box 0 (R2C2, R2C3, R3C2, R3C3) -> cells 10, 11, 19, 20.
    // Box 0 already has cell 0 (=1), cells 1,2 (=2,3), cells 9,18 (=2,3 wait — avoid duplicates in box!)
    // Use unique digits for box 0: row 0 cols 1,2 have 2,3; col 0 rows 1,2 have 4,5.
    digits[9] = 4;
    digits[18] = 5;
    digits[10] = 6;
    digits[11] = 7;
    digits[19] = 8;
    digits[20] = 9;
    // Also need cols[0] cells 27..72 to have unique values distinct from 1, 4, 5: 2, 3, 6, 7, 8, 9
    digits[27] = 2;
    digits[36] = 3;
    digits[45] = 6;
    digits[54] = 7;
    digits[63] = 8;
    digits[72] = 9;
    for (const c of [10, 11, 19, 20]) expected.add(c);

    const prev = makeCells(digits);
    const next = makeCells({ ...digits, 0: 1 });
    const res = detectNewlyCompletedUnits(prev, next, [0]);

    expect(res.rows).toEqual([0]);
    expect(res.cols).toEqual([0]);
    expect(res.boxes).toEqual([0]);
    expect(res.cells).toEqual(Array.from(expected).sort((a, b) => a - b));
    expect(new Set(res.cells).size).toBe(res.cells.length);
  });

  it('rejects units containing duplicate digits', () => {
    const dupMap: Record<number, number> = {};
    const row1 = ROWS[1]!;
    for (let i = 0; i < 8; i += 1) {
      dupMap[row1[i]!] = i + 1;
    }
    const prev = makeCells(dupMap);
    // Placing duplicate 1 instead of 9 must NOT count as complete
    const next = makeCells({ ...dupMap, [row1[8]!]: 1 });

    expect(isUnitComplete(next, row1)).toBe(false);
    expect(detectNewlyCompletedUnits(prev, next, [row1[8]!]).cells).toEqual([]);
  });

  it('does not re-trigger for units that were already complete before the move', () => {
    const digits: Record<number, number> = {};
    ROWS[2]!.forEach((cell, idx) => {
      digits[cell] = idx + 1;
    });
    // Replacing an entry inside already-complete unit stays complete, not newly completed
    const prev = makeCells(digits);
    const next = makeCells(digits);

    expect(detectNewlyCompletedUnits(prev, next, [ROWS[2]![0]!]).cells).toEqual([]);
  });

  it('is solution-independent (detects 1-9 permutation without peeking at solution)', () => {
    // Completely reversed order 9..1 across row 4 still counts cleanly
    const map: Record<number, number> = {};
    const row4 = ROWS[4]!;
    for (let i = 0; i < 8; i += 1) {
      map[row4[i]!] = 9 - i;
    }
    const prev = makeCells(map);
    const next = makeCells({ ...map, [row4[8]!]: 1 });

    const res = detectNewlyCompletedUnits(prev, next, [row4[8]!]);
    expect(res.rows).toEqual([4]);
    expect(res.cells).toEqual([...row4]);
  });
});

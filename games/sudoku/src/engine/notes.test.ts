import { describe, expect, it } from 'vitest';
import {
  canUndo,
  createSudokuState,
  digitBit,
  digitsToMask,
  getComputedCandidates,
  getVisibleNotes,
  hasDigitBit,
  maskToDigits,
  reduceSudoku,
  sudokuActions,
  type PuzzleRecord,
  type SudokuEvent,
  type SudokuState,
} from '../index';

const TEST_PUZZLE: PuzzleRecord = {
  id: 'test-notes-1',
  seed: 1,
  engineVersion: '0.1.0-dev',
  difficulty: 'easy',
  techniquesRequired: ['naked_single'],
  clues: '530070000600195000098000060800060003400803001700020006060000280000419005000080079',
  solution: '534678912672195348198342567859761423426853791713924856961537284287419635345286179',
};

function dispatchAll(initial: SudokuState, events: readonly SudokuEvent[]): SudokuState {
  return events.reduce((state, event) => reduceSudoku(state, event), initial);
}

describe('Sudoku notes invariants (D8, D12, D20)', () => {
  it('D8: placing a peer digit hides manual notes without deleting them; clearing or undoing restores them', () => {
    // Cell 2 is row 0 col 2 (empty); cell 3 is row 0 col 3 (empty peer in same row).
    // Row 0 already has givens {5, 3, 7}, Col 2 has {8}, Box 0 has {5, 3, 6, 9, 8}.
    let state = createSudokuState(TEST_PUZZLE);

    // Add manual notes 1, 2, 4 to cell 2.
    state = dispatchAll(state, [
      sudokuActions.toggleNote(2, 1),
      sudokuActions.toggleNote(2, 2),
      sudokuActions.toggleNote(2, 4),
    ]);
    expect(maskToDigits(getVisibleNotes(state, 2))).toEqual([1, 2, 4]);
    expect(maskToDigits(state.cells[2]?.manualNotes ?? 0)).toEqual([1, 2, 4]);

    // Place 4 in row peer cell 3 -> note 4 is hidden from cell 2, NOT deleted from manualNotes.
    const afterPlace = reduceSudoku(state, sudokuActions.placeDigit(3, 4));
    expect(maskToDigits(getVisibleNotes(afterPlace, 2))).toEqual([1, 2]);
    expect(maskToDigits(afterPlace.cells[2]?.manualNotes ?? 0)).toEqual([1, 2, 4]);

    // Clearing cell 3 immediately restores note 4 in cell 2.
    const afterClear = reduceSudoku(afterPlace, sudokuActions.clearCell(3));
    expect(maskToDigits(getVisibleNotes(afterClear, 2))).toEqual([1, 2, 4]);

    // Undoing the placement also restores note 4 in cell 2.
    const afterUndo = reduceSudoku(afterPlace, sudokuActions.undo());
    expect(maskToDigits(getVisibleNotes(afterUndo, 2))).toEqual([1, 2, 4]);
    expect(maskToDigits(afterUndo.cells[2]?.manualNotes ?? 0)).toEqual([1, 2, 4]);
  });

  it('D8: adding a manual note held by a peer stores it in manualNotes while hiding it until the peer clears', () => {
    // Cell 0 (peer in row 0) holds given 5, and cell 3 gets user-placed 4.
    let state = createSudokuState(TEST_PUZZLE);
    state = reduceSudoku(state, sudokuActions.placeDigit(3, 4));

    // Player toggles note 4 in cell 2 even though peer cell 3 currently holds 4.
    state = reduceSudoku(state, sudokuActions.toggleNote(2, 4));
    expect(hasDigitBit(state.cells[2]?.manualNotes ?? 0, 4)).toBe(true);
    expect(hasDigitBit(getVisibleNotes(state, 2), 4)).toBe(false);

    // Once cell 3 is cleared, note 4 becomes visible in cell 2.
    state = reduceSudoku(state, sudokuActions.clearCell(3));
    expect(hasDigitBit(getVisibleNotes(state, 2), 4)).toBe(true);
  });

  it('D8: placing and clearing/undoing a digit on a cell preserves that cell own manualNotes', () => {
    let state = createSudokuState(TEST_PUZZLE);
    state = dispatchAll(state, [
      sudokuActions.toggleNote(2, 1),
      sudokuActions.toggleNote(2, 2),
      sudokuActions.toggleNote(2, 4),
    ]);

    // Place 4 directly in cell 2 -> notes are hidden while filled, manualNotes preserved.
    const filled = reduceSudoku(state, sudokuActions.placeDigit(2, 4));
    expect(getVisibleNotes(filled, 2)).toBe(0);
    expect(maskToDigits(filled.cells[2]?.manualNotes ?? 0)).toEqual([1, 2, 4]);

    const cleared = reduceSudoku(filled, sudokuActions.clearCell(2));
    expect(maskToDigits(getVisibleNotes(cleared, 2))).toEqual([1, 2, 4]);

    const undone = reduceSudoku(filled, sudokuActions.undo());
    expect(maskToDigits(getVisibleNotes(undone, 2))).toEqual([1, 2, 4]);
  });

  it('D12 & D20: auto-show preserves manualNotes, persists overlay edits across neighbor changes, and discards on toggle OFF', () => {
    // Cell 2 computed candidates initially: row 0 {5,3,7}, col 2 {8}, box 0 {5,3,6,9,8} -> legal = {1,2,4}.
    let state = createSudokuState(TEST_PUZZLE);
    state = dispatchAll(state, [sudokuActions.toggleNote(2, 1), sudokuActions.toggleNote(2, 2)]);
    const savedManualMask = digitsToMask([1, 2]);
    expect(state.cells[2]?.manualNotes).toBe(savedManualMask);

    // Toggle auto-show ON -> computed candidates {1,2,4} appear; manualNotes untouched.
    state = reduceSudoku(state, sudokuActions.toggleAutoShow());
    expect(state.autoShowEnabled).toBe(true);
    expect(maskToDigits(getComputedCandidates(state.cells, 2))).toEqual([1, 2, 4]);
    expect(maskToDigits(getVisibleNotes(state, 2))).toEqual([1, 2, 4]);
    expect(state.cells[2]?.manualNotes).toBe(savedManualMask);

    // Manually eliminate candidate 1 from cell 2 while auto-show is ON.
    state = reduceSudoku(state, sudokuActions.toggleNote(2, 1));
    expect(maskToDigits(getVisibleNotes(state, 2))).toEqual([2, 4]);
    expect(hasDigitBit(state.cells[2]?.autoShowExcluded ?? 0, 1)).toBe(true);
    expect(state.cells[2]?.manualNotes).toBe(savedManualMask);

    // Fill neighbor cell 3 (row 0 col 3) with 6 -> unrelated to 1,2,4 except shrinking computed candidates.
    // D20: manual elimination of 1 MUST persist!
    state = reduceSudoku(state, sudokuActions.placeDigit(3, 6));
    expect(maskToDigits(getVisibleNotes(state, 2))).toEqual([2, 4]);

    // Fill neighbor cell 3 with 4 instead -> newly placed peer 4 hides 4 automatically under D8,
    // and elimination of 1 STILL persists!
    state = reduceSudoku(state, sudokuActions.placeDigit(3, 4));
    expect(maskToDigits(getVisibleNotes(state, 2))).toEqual([2]);

    // Clear neighbor cell 3 -> 4 returns to cell 2, while manual elimination of 1 STILL persists!
    state = reduceSudoku(state, sudokuActions.clearCell(3));
    expect(maskToDigits(getVisibleNotes(state, 2))).toEqual([2, 4]);

    // Toggle auto-show OFF -> overlay discarded, exact saved manualNotes [1, 2] restored!
    state = reduceSudoku(state, sudokuActions.toggleAutoShow());
    expect(state.autoShowEnabled).toBe(false);
    expect(state.cells[2]?.autoShowExcluded).toBe(0);
    expect(state.cells[2]?.autoShowAdded).toBe(0);
    expect(maskToDigits(getVisibleNotes(state, 2))).toEqual([1, 2]);
  });

  it('D20: clearing an empty cell in auto-show ON hides visible candidates without touching manualNotes', () => {
    let state = createSudokuState(TEST_PUZZLE);
    state = reduceSudoku(state, sudokuActions.toggleNote(2, 1));
    state = reduceSudoku(state, sudokuActions.toggleAutoShow());

    expect(maskToDigits(getVisibleNotes(state, 2))).toEqual([1, 2, 4]);
    state = reduceSudoku(state, sudokuActions.clearCell(2));
    expect(getVisibleNotes(state, 2)).toBe(0);
    expect(state.cells[2]?.manualNotes).toBe(digitBit(1));

    // Turning auto-show OFF restores manual note 1.
    state = reduceSudoku(state, sudokuActions.toggleAutoShow());
    expect(maskToDigits(getVisibleNotes(state, 2))).toEqual([1]);
  });

  it('D20: undoing after auto-show was toggled OFF never resurrects discarded overlay edits', () => {
    let state = createSudokuState(TEST_PUZZLE);
    state = reduceSudoku(state, sudokuActions.toggleNote(2, 1));
    state = reduceSudoku(state, sudokuActions.toggleAutoShow());

    // Edit note inside auto-show session 1, then toggle auto-show OFF.
    state = reduceSudoku(state, sudokuActions.toggleNote(2, 4));
    state = reduceSudoku(state, sudokuActions.toggleAutoShow());
    expect(state.autoShowEnabled).toBe(false);

    // Discarded overlay-only edit should not resurrect on UNDO, nor even if auto-show turns back ON.
    expect(canUndo(state)).toBe(true);
    const undoneOnce = reduceSudoku(state, sudokuActions.undo());
    // Undoing skips the discarded overlay edit and reverts the pre-auto-show toggleNote(2, 1).
    expect(undoneOnce.cells[2]?.manualNotes).toBe(0);

    const autoShowAgain = reduceSudoku(undoneOnce, sudokuActions.toggleAutoShow());
    expect(autoShowAgain.cells[2]?.autoShowExcluded).toBe(0);
    expect(autoShowAgain.cells[2]?.autoShowAdded).toBe(0);
    expect(maskToDigits(getVisibleNotes(autoShowAgain, 2))).toEqual([1, 2, 4]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  BOARD_SIZE,
  SUDOKU_STATE_SCHEMA_VERSION,
  canRedo,
  canUndo,
  createSudokuState,
  deserializeSudokuState,
  digitBit,
  extractSudokuStats,
  getDuplicateConflicts,
  getHighlightMap,
  getRemainingDigitCounts,
  getStarterBank,
  getStarterPuzzle,
  getStarterPuzzlesByDifficulty,
  getVisibleNotes,
  getWrongValueCells,
  isPuzzleSolved,
  pickNextStarterPuzzle,
  reduceSudoku,
  serializeSudokuState,
  sudokuActions,
  sudokuPlugin,
  type PuzzleRecord,
} from '../index';

const TEST_PUZZLE: PuzzleRecord = {
  id: 'test-reducer-1',
  seed: 1,
  engineVersion: '0.1.0-dev',
  difficulty: 'easy',
  techniquesRequired: ['naked_single', 'hidden_single'],
  clues: '530070000600195000098000060800060003400803001700020006060000280000419005000080079',
  solution: '534678912672195348198342567859761423426853791713924856961537284287419635345286179',
};

describe('Sudoku reducer, D21 mistake model, hints, serialization, and starter bank', () => {
  it('D21: detects row, column, and box duplicate conflicts independently of wrong-value checks', () => {
    let state = createSudokuState(TEST_PUZZLE);

    // Cell 2 (row 0 col 2, box 0, solution=4):
    // 1. Place 5 -> duplicates row 0 & box 0 cell 0 (given 5).
    const rowDup = reduceSudoku(state, sudokuActions.placeDigit(2, 5));
    expect(getDuplicateConflicts(rowDup.cells)).toEqual([0, 2]);
    expect(getWrongValueCells(rowDup.cells, TEST_PUZZLE.solution)).toEqual([2]);

    // 2. Place 1 -> valid relative to row 0/col 2/box 0 peers, so zero duplicate conflicts,
    //    even though solution[2] is 4 (wrong value).
    state = reduceSudoku(state, sudokuActions.placeDigit(2, 1));
    expect(getDuplicateConflicts(state.cells)).toEqual([]);
    expect(getWrongValueCells(state.cells, TEST_PUZZLE.solution)).toEqual([2]);

    // 3. Column duplicate: cell 74 is row 8 col 2 (solution=5); place 1 -> duplicates cell 2 in col 2.
    const colDup = reduceSudoku(state, sudokuActions.placeDigit(74, 1));
    expect(getDuplicateConflicts(colDup.cells)).toEqual([2, 74]);

    // 4. CHECK_BOARD records wrong values and clears each cell flag when corrected or cleared.
    state = reduceSudoku(state, sudokuActions.checkBoard());
    expect(state.checkedWrongCells).toEqual([2]);

    const cleared = reduceSudoku(state, sudokuActions.clearCell(2));
    expect(cleared.checkedWrongCells).toEqual([]);

    const corrected = reduceSudoku(state, sudokuActions.placeDigit(2, 4));
    expect(corrected.checkedWrongCells).toEqual([]);

    const clearedCheck = reduceSudoku(state, sudokuActions.clearCheckBoard());
    expect(clearedCheck.checkedWrongCells).toEqual([]);
  });

  it('supports multi-step undo/redo, truncates redo branch on new edits, and keeps UI actions out of history', () => {
    let state = createSudokuState(TEST_PUZZLE);

    // UI/session actions do not create history entries.
    state = reduceSudoku(state, sudokuActions.selectCell(2));
    state = reduceSudoku(state, sudokuActions.toggleNotesMode());
    state = reduceSudoku(state, sudokuActions.tickTimer(1500));
    state = reduceSudoku(state, sudokuActions.checkBoard());
    expect(state.history).toHaveLength(0);
    expect(canUndo(state)).toBe(false);
    expect(canRedo(state)).toBe(false);

    state = reduceSudoku(state, sudokuActions.placeDigit(2, 1));
    state = reduceSudoku(state, sudokuActions.placeDigit(3, 6));
    expect(state.history).toHaveLength(2);
    expect(state.historyCursor).toBe(2);
    expect(canUndo(state)).toBe(true);
    expect(canRedo(state)).toBe(false);

    state = reduceSudoku(state, sudokuActions.undo());
    expect(state.cells[3]?.value).toBe(0);
    expect(state.cells[2]?.value).toBe(1);
    expect(canRedo(state)).toBe(true);

    // Redo restores cell 3.
    const redone = reduceSudoku(state, sudokuActions.redo());
    expect(redone.cells[3]?.value).toBe(6);
    expect(canRedo(redone)).toBe(false);

    // New mutation at cursor=1 truncates the undone redo branch cleanly.
    const branched = reduceSudoku(state, sudokuActions.placeDigit(2, 4));
    expect(branched.history).toHaveLength(2);
    expect(canRedo(branched)).toBe(false);
    expect(branched.cells[2]?.value).toBe(4);
    expect(branched.cells[3]?.value).toBe(0);
  });

  it('applies Tier-4 hint steps atomically and deduplicates RECORD_HINT_VIEWED per board state', () => {
    let state = createSudokuState(TEST_PUZZLE);
    state = reduceSudoku(state, sudokuActions.toggleNote(2, 1));
    state = reduceSudoku(state, sudokuActions.toggleNote(2, 4));

    // Viewing tiers 1-3 twice on same board state counts once.
    state = reduceSudoku(state, sudokuActions.recordHintViewed());
    state = reduceSudoku(state, sudokuActions.recordHintViewed());
    expect(state.hintsUsed).toBe(1);

    // Applying Tier 4 after viewing tiers 1-3 does not double-count hintsUsed.
    state = reduceSudoku(
      state,
      sudokuActions.applyHintStep([{ cell: 3, digit: 6 }], [{ cell: 2, digit: 1 }]),
    );
    expect(state.hintsUsed).toBe(1);
    expect(state.cells[3]?.value).toBe(6);
    expect(state.cells[2]?.manualNotes).toBe(digitBit(4));

    // Undo reverts both placement and elimination atomically.
    const undone = reduceSudoku(state, sudokuActions.undo());
    expect(undone.cells[3]?.value).toBe(0);
    expect(undone.cells[2]?.manualNotes).toBe(digitBit(1) | digitBit(4));

    // Applying a Tier-4 hint directly (without prior RECORD_HINT_VIEWED) increments hintsUsed.
    const directHint = reduceSudoku(
      undone,
      sudokuActions.applyHintStep([{ cell: 2, digit: 4 }], []),
    );
    expect(directHint.hintsUsed).toBe(2);

    // Works in auto-show ON mode as well (eliminating candidate into autoShowExcluded).
    let autoState = createSudokuState(TEST_PUZZLE);
    autoState = reduceSudoku(autoState, sudokuActions.toggleAutoShow());
    autoState = reduceSudoku(
      autoState,
      sudokuActions.applyHintStep([], [{ cell: 2, digit: 1 }]),
    );
    expect(getVisibleNotes(autoState, 2) & digitBit(1)).toBe(0);
  });

  it('enforces immutability of givens, pause timer/mutation guards, highlights, remaining counts, and completion', () => {
    const state = createSudokuState(TEST_PUZZLE);

    // Given cell 0 holds '5'.
    expect(state.cells[0]?.given).toBe(true);
    expect(reduceSudoku(state, sudokuActions.placeDigit(0, 9)).cells[0]?.value).toBe(5);
    expect(reduceSudoku(state, sudokuActions.clearCell(0)).cells[0]?.value).toBe(5);
    expect(reduceSudoku(state, sudokuActions.toggleNote(0, 1)).cells[0]?.manualNotes).toBe(0);
    expect(
      reduceSudoku(state, sudokuActions.applyHintStep([{ cell: 0, digit: 9 }], [])).cells[0]
        ?.value,
    ).toBe(5);

    // Highlights for given cell 0 ('5'): peers + other cells with '5' (cells 14, 71).
    const highlighted = reduceSudoku(state, sudokuActions.selectCell(0));
    const map = getHighlightMap(highlighted);
    expect(map.selected).toBe(0);
    expect(map.peers).toHaveLength(20);
    expect(map.sameDigit).toEqual([14, 71]);

    // Pause blocks gameplay mutations and TICK_TIMER.
    const paused = reduceSudoku(highlighted, sudokuActions.setPaused(true));
    expect(reduceSudoku(paused, sudokuActions.placeDigit(2, 4)).cells[2]?.value).toBe(0);
    expect(reduceSudoku(paused, sudokuActions.tickTimer(5000)).elapsedMs).toBe(0);

    // Resume and tick timer, then fill every empty cell to completion.
    let playing = reduceSudoku(paused, sudokuActions.setPaused(false));
    playing = reduceSudoku(playing, sudokuActions.tickTimer(2500));
    expect(playing.elapsedMs).toBe(2500);

    const remainingInitial = getRemainingDigitCounts(playing.cells);
    expect(remainingInitial[5]).toBe(6); // Three 5s in initial clues -> 6 remaining.

    for (let i = 0; i < BOARD_SIZE; i += 1) {
      if (playing.cells[i]?.given) {
        continue;
      }
      const solDigit = Number(TEST_PUZZLE.solution.charAt(i));
      playing = reduceSudoku(playing, sudokuActions.placeDigit(i, solDigit));
    }

    expect(isPuzzleSolved(playing.cells, TEST_PUZZLE.solution)).toBe(true);
    expect(playing.completed).toBe(true);
    expect(getRemainingDigitCounts(playing.cells)[4]).toBe(0);
    // Completed boards reject further ticks/moves.
    expect(reduceSudoku(playing, sudokuActions.tickTimer(1000)).elapsedMs).toBe(2500);
  });

  it('round-trips serializeSudokuState / deserializeSudokuState and integrates with starterBank & GamePlugin', () => {
    const bank = getStarterBank();
    expect(bank.schemaVersion).toBe(1);
    expect(getStarterPuzzlesByDifficulty('easy')).toHaveLength(50);
    expect(getStarterPuzzlesByDifficulty('medium')).toHaveLength(50);
    expect(getStarterPuzzlesByDifficulty('hard')).toHaveLength(50);

    const firstEasy = getStarterPuzzle('easy', 0);
    const nextEasy = pickNextStarterPuzzle('easy', new Set([firstEasy.id]));
    expect(nextEasy?.id).not.toBe(firstEasy.id);

    let state = createSudokuState(firstEasy, { mode: 'daily', dailyDate: '2026-11-27' });
    const firstEmpty = state.cells.findIndex((c) => !c.given);
    state = reduceSudoku(state, sudokuActions.toggleNote(firstEmpty, 1));
    state = reduceSudoku(state, sudokuActions.selectCell(firstEmpty));
    state = reduceSudoku(state, sudokuActions.tickTimer(4200));

    const encoded = serializeSudokuState(state);
    const decoded = deserializeSudokuState(encoded);
    expect(decoded).toEqual(state);

    const envelopeCheck = JSON.parse(encoded) as { schemaVersion: number };
    expect(envelopeCheck.schemaVersion).toBe(SUDOKU_STATE_SCHEMA_VERSION);

    expect(() => deserializeSudokuState('{bad')).toThrow(/JSON/);
    expect(() => deserializeSudokuState(JSON.stringify({ schemaVersion: 99, state }))).toThrow(
      /schemaVersion/,
    );

    const pluginInit = sudokuPlugin.createInitialState();
    expect(pluginInit.puzzle.id).toBe(firstEasy.id);
    const stats = extractSudokuStats(state);
    expect(stats).toEqual({
      gamesStarted: 1,
      gamesWon: 0,
      totalPlayMs: 4200,
      difficulty: 'easy',
      mode: 'daily',
      hintsUsed: 0,
      completed: false,
    });
  });
});

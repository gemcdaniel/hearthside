import {
  ALL_DIGITS_MASK,
  BOARD_SIZE,
  digitBit,
  isValidCellIndex,
  isValidDigit,
  parseBoardDigits,
} from './boardMath';
import {
  getComputedCandidates,
  getVisibleNotes,
  getWrongValueCells,
  isHistoryEntryActive,
  isPuzzleSolved,
} from './selectors';
import type {
  ApplyHintStepEvent,
  CellChange,
  CheckBoardEvent,
  ClearCellEvent,
  ClearCheckBoardEvent,
  PlaceDigitEvent,
  PuzzleRecord,
  RecordHintViewedEvent,
  RedoEvent,
  SelectCellEvent,
  SetPausedEvent,
  SudokuCell,
  SudokuElimination,
  SudokuEvent,
  SudokuHistoryEntry,
  SudokuHistoryKind,
  SudokuMode,
  SudokuPlacement,
  SudokuState,
  TickTimerEvent,
  ToggleAutoShowEvent,
  ToggleNoteEvent,
  ToggleNotesModeEvent,
  UndoEvent,
} from './types';

export interface CreateSudokuStateOptions {
  readonly mode?: SudokuMode;
  readonly dailyDate?: string;
}

export function createSudokuState(
  puzzle: PuzzleRecord,
  options: CreateSudokuStateOptions = {},
): SudokuState {
  const clueDigits = parseBoardDigits(puzzle.clues, 'clues');
  parseBoardDigits(puzzle.solution, 'solution');

  const cells: SudokuCell[] = clueDigits.map((value) => ({
    value,
    given: value !== 0,
    manualNotes: 0,
    autoShowExcluded: 0,
    autoShowAdded: 0,
  }));

  return {
    puzzle,
    mode: options.mode ?? 'standard',
    dailyDate: options.dailyDate,
    cells,
    autoShowEnabled: false,
    autoShowSession: 0,
    notesMode: false,
    selectedCell: null,
    checkedWrongCells: [],
    elapsedMs: 0,
    paused: false,
    completed: isPuzzleSolved(cells, puzzle.solution),
    hintsUsed: 0,
    hintViewedForCurrentBoard: false,
    history: [],
    historyCursor: 0,
    nextHistoryId: 1,
  };
}

export const sudokuActions = {
  placeDigit: (cell: number, digit: number, timestampMs = Date.now()): PlaceDigitEvent => ({
    type: 'PLACE_DIGIT',
    payload: { cell, digit },
    timestampMs,
  }),
  clearCell: (cell: number, timestampMs = Date.now()): ClearCellEvent => ({
    type: 'CLEAR_CELL',
    payload: { cell },
    timestampMs,
  }),
  toggleNote: (cell: number, digit: number, timestampMs = Date.now()): ToggleNoteEvent => ({
    type: 'TOGGLE_NOTE',
    payload: { cell, digit },
    timestampMs,
  }),
  applyHintStep: (
    placements: readonly SudokuPlacement[],
    eliminations: readonly SudokuElimination[],
    timestampMs = Date.now(),
  ): ApplyHintStepEvent => ({
    type: 'APPLY_HINT_STEP',
    payload: { placements, eliminations },
    timestampMs,
  }),
  undo: (timestampMs = Date.now()): UndoEvent => ({
    type: 'UNDO',
    payload: undefined,
    timestampMs,
  }),
  redo: (timestampMs = Date.now()): RedoEvent => ({
    type: 'REDO',
    payload: undefined,
    timestampMs,
  }),
  selectCell: (cell: number | null, timestampMs = Date.now()): SelectCellEvent => ({
    type: 'SELECT_CELL',
    payload: { cell },
    timestampMs,
  }),
  toggleNotesMode: (timestampMs = Date.now()): ToggleNotesModeEvent => ({
    type: 'TOGGLE_NOTES_MODE',
    payload: undefined,
    timestampMs,
  }),
  toggleAutoShow: (timestampMs = Date.now()): ToggleAutoShowEvent => ({
    type: 'TOGGLE_AUTO_SHOW',
    payload: undefined,
    timestampMs,
  }),
  setPaused: (paused: boolean, timestampMs = Date.now()): SetPausedEvent => ({
    type: 'SET_PAUSED',
    payload: { paused },
    timestampMs,
  }),
  tickTimer: (deltaMs: number, timestampMs = Date.now()): TickTimerEvent => ({
    type: 'TICK_TIMER',
    payload: { deltaMs },
    timestampMs,
  }),
  checkBoard: (timestampMs = Date.now()): CheckBoardEvent => ({
    type: 'CHECK_BOARD',
    payload: undefined,
    timestampMs,
  }),
  clearCheckBoard: (timestampMs = Date.now()): ClearCheckBoardEvent => ({
    type: 'CLEAR_CHECK_BOARD',
    payload: undefined,
    timestampMs,
  }),
  recordHintViewed: (timestampMs = Date.now()): RecordHintViewedEvent => ({
    type: 'RECORD_HINT_VIEWED',
    payload: undefined,
    timestampMs,
  }),
};

function makeCellChange(cellIndex: number, prev: SudokuCell, next: SudokuCell): CellChange {
  return {
    cell: cellIndex,
    prevValue: prev.value,
    nextValue: next.value,
    prevManualNotes: prev.manualNotes,
    nextManualNotes: next.manualNotes,
    prevAutoShowExcluded: prev.autoShowExcluded,
    nextAutoShowExcluded: next.autoShowExcluded,
    prevAutoShowAdded: prev.autoShowAdded,
    nextAutoShowAdded: next.autoShowAdded,
  };
}

function hasCellChanged(prev: SudokuCell, next: SudokuCell): boolean {
  return (
    prev.value !== next.value ||
    prev.manualNotes !== next.manualNotes ||
    prev.autoShowExcluded !== next.autoShowExcluded ||
    prev.autoShowAdded !== next.autoShowAdded
  );
}

function removeFromChecked(checkedWrongCells: readonly number[], cellsToRemove: ReadonlySet<number>): number[] {
  if (checkedWrongCells.length === 0 || cellsToRemove.size === 0) {
    return [...checkedWrongCells];
  }
  return checkedWrongCells.filter((idx) => !cellsToRemove.has(idx));
}

function commitHistoryChanges(
  state: SudokuState,
  kind: SudokuHistoryKind,
  timestampMs: number,
  autoShowSession: number | null,
  nextCells: readonly SudokuCell[],
  changes: readonly CellChange[],
  hintIncrement = 0,
): SudokuState {
  if (changes.length === 0) {
    return state;
  }

  const entry: SudokuHistoryEntry = {
    id: state.nextHistoryId,
    kind,
    timestampMs,
    autoShowSession,
    changes,
  };

  const truncatedHistory = state.history.slice(0, state.historyCursor);
  const nextHistory = [...truncatedHistory, entry];
  const touchedCells = new Set(changes.map((c) => c.cell));

  return {
    ...state,
    cells: nextCells,
    checkedWrongCells: removeFromChecked(state.checkedWrongCells, touchedCells),
    completed: isPuzzleSolved(nextCells, state.puzzle.solution),
    hintsUsed: state.hintsUsed + hintIncrement,
    hintViewedForCurrentBoard: false,
    history: nextHistory,
    historyCursor: nextHistory.length,
    nextHistoryId: state.nextHistoryId + 1,
  };
}

function handlePlaceDigit(state: SudokuState, event: PlaceDigitEvent): SudokuState {
  const { cell, digit } = event.payload;
  if (!isValidCellIndex(cell) || !isValidDigit(digit)) {
    return state;
  }

  const prevCell = state.cells[cell];
  if (!prevCell || prevCell.given || prevCell.value === digit) {
    return state;
  }

  const nextCell: SudokuCell = {
    ...prevCell,
    value: digit,
  };
  const nextCells = [...state.cells];
  nextCells[cell] = nextCell;

  return commitHistoryChanges(
    state,
    'PLACE_DIGIT',
    event.timestampMs,
    null,
    nextCells,
    [makeCellChange(cell, prevCell, nextCell)],
  );
}

function handleClearCell(state: SudokuState, event: ClearCellEvent): SudokuState {
  const { cell } = event.payload;
  if (!isValidCellIndex(cell)) {
    return state;
  }

  const prevCell = state.cells[cell];
  if (!prevCell || prevCell.given) {
    return state;
  }

  if (prevCell.value !== 0) {
    const nextCell: SudokuCell = {
      ...prevCell,
      value: 0,
    };
    const nextCells = [...state.cells];
    nextCells[cell] = nextCell;

    return commitHistoryChanges(
      state,
      'CLEAR_CELL',
      event.timestampMs,
      null,
      nextCells,
      [makeCellChange(cell, prevCell, nextCell)],
    );
  }

  if (!state.autoShowEnabled) {
    if (prevCell.manualNotes === 0) {
      return state;
    }
    const nextCell: SudokuCell = {
      ...prevCell,
      manualNotes: 0,
    };
    const nextCells = [...state.cells];
    nextCells[cell] = nextCell;

    return commitHistoryChanges(
      state,
      'CLEAR_CELL',
      event.timestampMs,
      null,
      nextCells,
      [makeCellChange(cell, prevCell, nextCell)],
    );
  }

  const visible = getVisibleNotes(state, cell);
  if (visible === 0 && prevCell.autoShowAdded === 0) {
    return state;
  }
  const nextCell: SudokuCell = {
    ...prevCell,
    autoShowExcluded: (prevCell.autoShowExcluded | visible) & ALL_DIGITS_MASK,
    autoShowAdded: 0,
  };
  if (!hasCellChanged(prevCell, nextCell)) {
    return state;
  }

  const nextCells = [...state.cells];
  nextCells[cell] = nextCell;

  return commitHistoryChanges(
    state,
    'CLEAR_CELL',
    event.timestampMs,
    state.autoShowSession,
    nextCells,
    [makeCellChange(cell, prevCell, nextCell)],
  );
}

function handleToggleNote(state: SudokuState, event: ToggleNoteEvent): SudokuState {
  const { cell, digit } = event.payload;
  if (!isValidCellIndex(cell) || !isValidDigit(digit)) {
    return state;
  }

  const prevCell = state.cells[cell];
  if (!prevCell || prevCell.given || prevCell.value !== 0) {
    return state;
  }

  const bit = digitBit(digit);

  if (!state.autoShowEnabled) {
    const nextCell: SudokuCell = {
      ...prevCell,
      manualNotes: (prevCell.manualNotes ^ bit) & ALL_DIGITS_MASK,
    };
    const nextCells = [...state.cells];
    nextCells[cell] = nextCell;

    return commitHistoryChanges(
      state,
      'TOGGLE_NOTE',
      event.timestampMs,
      null,
      nextCells,
      [makeCellChange(cell, prevCell, nextCell)],
    );
  }

  const computedMask = getComputedCandidates(state.cells, cell);
  let nextAutoShowExcluded = prevCell.autoShowExcluded;
  let nextAutoShowAdded = prevCell.autoShowAdded;

  if ((computedMask & bit) !== 0) {
    nextAutoShowExcluded = (nextAutoShowExcluded ^ bit) & ALL_DIGITS_MASK;
    nextAutoShowAdded &= ~bit;
  } else {
    nextAutoShowAdded = (nextAutoShowAdded ^ bit) & ALL_DIGITS_MASK;
    nextAutoShowExcluded &= ~bit;
  }

  const nextCell: SudokuCell = {
    ...prevCell,
    autoShowExcluded: nextAutoShowExcluded,
    autoShowAdded: nextAutoShowAdded,
  };
  const nextCells = [...state.cells];
  nextCells[cell] = nextCell;

  return commitHistoryChanges(
    state,
    'TOGGLE_NOTE',
    event.timestampMs,
    state.autoShowSession,
    nextCells,
    [makeCellChange(cell, prevCell, nextCell)],
  );
}

function handleApplyHintStep(state: SudokuState, event: ApplyHintStepEvent): SudokuState {
  const nextCells = [...state.cells];
  const touchedIndices: number[] = [];
  const touchedSet = new Set<number>();
  let touchedOverlay = false;

  const markTouched = (cellIdx: number) => {
    if (!touchedSet.has(cellIdx)) {
      touchedSet.add(cellIdx);
      touchedIndices.push(cellIdx);
    }
  };

  for (const { cell, digit } of event.payload.placements) {
    if (!isValidCellIndex(cell) || !isValidDigit(digit)) {
      continue;
    }
    const current = nextCells[cell];
    if (!current || current.given || current.value === digit) {
      continue;
    }
    nextCells[cell] = {
      ...current,
      value: digit,
    };
    markTouched(cell);
  }

  for (const { cell, digit } of event.payload.eliminations) {
    if (!isValidCellIndex(cell) || !isValidDigit(digit)) {
      continue;
    }
    const current = nextCells[cell];
    if (!current || current.given || current.value !== 0) {
      continue;
    }
    const bit = digitBit(digit);

    if (!state.autoShowEnabled) {
      if ((current.manualNotes & bit) === 0) {
        continue;
      }
      nextCells[cell] = {
        ...current,
        manualNotes: (current.manualNotes & ~bit) & ALL_DIGITS_MASK,
      };
      markTouched(cell);
    } else {
      const visibleBefore = getVisibleNotes({ ...state, cells: nextCells }, cell);
      if ((visibleBefore & bit) === 0 && (current.autoShowAdded & bit) === 0) {
        continue;
      }
      nextCells[cell] = {
        ...current,
        autoShowExcluded: (current.autoShowExcluded | bit) & ALL_DIGITS_MASK,
        autoShowAdded: current.autoShowAdded & ~bit,
      };
      touchedOverlay = true;
      markTouched(cell);
    }
  }

  const changes: CellChange[] = [];
  for (const cellIdx of touchedIndices) {
    const prev = state.cells[cellIdx];
    const next = nextCells[cellIdx];
    if (prev && next && hasCellChanged(prev, next)) {
      changes.push(makeCellChange(cellIdx, prev, next));
    }
  }

  if (changes.length === 0) {
    return state;
  }

  const hintIncrement = state.hintViewedForCurrentBoard ? 0 : 1;
  return commitHistoryChanges(
    state,
    'APPLY_HINT_STEP',
    event.timestampMs,
    touchedOverlay ? state.autoShowSession : null,
    nextCells,
    changes,
    hintIncrement,
  );
}

function applyHistoryEntry(
  state: SudokuState,
  entry: SudokuHistoryEntry,
  direction: 'undo' | 'redo',
  nextCursor: number,
): SudokuState {
  const applyOverlayMasks =
    state.autoShowEnabled &&
    entry.autoShowSession !== null &&
    state.autoShowSession === entry.autoShowSession;

  const nextCells = [...state.cells];
  const touchedCells = new Set<number>();

  for (const change of entry.changes) {
    const current = nextCells[change.cell];
    if (!current) {
      continue;
    }
    const targetValue = direction === 'undo' ? change.prevValue : change.nextValue;
    const targetManualNotes = direction === 'undo' ? change.prevManualNotes : change.nextManualNotes;
    const targetExcluded = applyOverlayMasks
      ? direction === 'undo'
        ? change.prevAutoShowExcluded
        : change.nextAutoShowExcluded
      : current.autoShowExcluded;
    const targetAdded = applyOverlayMasks
      ? direction === 'undo'
        ? change.prevAutoShowAdded
        : change.nextAutoShowAdded
      : current.autoShowAdded;

    nextCells[change.cell] = {
      ...current,
      value: targetValue,
      manualNotes: targetManualNotes,
      autoShowExcluded: targetExcluded,
      autoShowAdded: targetAdded,
    };
    touchedCells.add(change.cell);
  }

  return {
    ...state,
    cells: nextCells,
    checkedWrongCells: removeFromChecked(state.checkedWrongCells, touchedCells),
    completed: isPuzzleSolved(nextCells, state.puzzle.solution),
    hintViewedForCurrentBoard: false,
    historyCursor: nextCursor,
  };
}

function handleUndo(state: SudokuState): SudokuState {
  for (let idx = state.historyCursor - 1; idx >= 0; idx -= 1) {
    const entry = state.history[idx];
    if (!entry || !isHistoryEntryActive(state, entry)) {
      continue;
    }
    return applyHistoryEntry(state, entry, 'undo', idx);
  }
  return state;
}

function handleRedo(state: SudokuState): SudokuState {
  for (let idx = state.historyCursor; idx < state.history.length; idx += 1) {
    const entry = state.history[idx];
    if (!entry || !isHistoryEntryActive(state, entry)) {
      continue;
    }
    return applyHistoryEntry(state, entry, 'redo', idx + 1);
  }
  return state;
}

function handleToggleAutoShow(state: SudokuState): SudokuState {
  const nextEnabled = !state.autoShowEnabled;
  const resetCells = state.cells.map((cell) =>
    cell.autoShowExcluded === 0 && cell.autoShowAdded === 0
      ? cell
      : {
          ...cell,
          autoShowExcluded: 0,
          autoShowAdded: 0,
        },
  );

  return {
    ...state,
    cells: resetCells,
    autoShowEnabled: nextEnabled,
    autoShowSession: nextEnabled ? state.autoShowSession + 1 : state.autoShowSession,
  };
}

export function reduceSudoku(state: SudokuState, event: SudokuEvent): SudokuState {
  switch (event.type) {
    case 'SELECT_CELL': {
      const target = event.payload.cell;
      if (target !== null && !isValidCellIndex(target)) {
        return state;
      }
      return target === state.selectedCell ? state : { ...state, selectedCell: target };
    }

    case 'TOGGLE_NOTES_MODE':
      return { ...state, notesMode: !state.notesMode };

    case 'TOGGLE_AUTO_SHOW':
      return handleToggleAutoShow(state);

    case 'SET_PAUSED':
      if (state.completed || state.paused === event.payload.paused) {
        return state;
      }
      return { ...state, paused: event.payload.paused };

    case 'TICK_TIMER': {
      const { deltaMs } = event.payload;
      if (
        state.paused ||
        state.completed ||
        !Number.isFinite(deltaMs) ||
        deltaMs <= 0
      ) {
        return state;
      }
      return { ...state, elapsedMs: state.elapsedMs + deltaMs };
    }

    case 'CHECK_BOARD': {
      if (state.paused || state.completed) {
        return state;
      }
      return {
        ...state,
        checkedWrongCells: getWrongValueCells(state.cells, state.puzzle.solution),
      };
    }

    case 'CLEAR_CHECK_BOARD':
      return state.checkedWrongCells.length === 0 ? state : { ...state, checkedWrongCells: [] };

    case 'RECORD_HINT_VIEWED':
      if (state.paused || state.completed || state.hintViewedForCurrentBoard) {
        return state;
      }
      return {
        ...state,
        hintsUsed: state.hintsUsed + 1,
        hintViewedForCurrentBoard: true,
      };

    case 'PLACE_DIGIT':
      if (state.paused || state.completed) {
        return state;
      }
      return handlePlaceDigit(state, event);

    case 'CLEAR_CELL':
      if (state.paused || state.completed) {
        return state;
      }
      return handleClearCell(state, event);

    case 'TOGGLE_NOTE':
      if (state.paused || state.completed) {
        return state;
      }
      return handleToggleNote(state, event);

    case 'APPLY_HINT_STEP':
      if (state.paused || state.completed) {
        return state;
      }
      return handleApplyHintStep(state, event);

    case 'UNDO':
      if (state.paused || state.completed) {
        return state;
      }
      return handleUndo(state);

    case 'REDO':
      if (state.paused || state.completed) {
        return state;
      }
      return handleRedo(state);
  }
}

export function clearNonGivenCount(cells: readonly SudokuCell[]): number {
  let count = 0;
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const cell = cells[i];
    if (cell && !cell.given && cell.value !== 0) {
      count += 1;
    }
  }
  return count;
}

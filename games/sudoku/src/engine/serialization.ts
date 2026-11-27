import { ALL_DIGITS_MASK, BOARD_SIZE } from './boardMath';
import type {
  CellChange,
  PuzzleRecord,
  SudokuCell,
  SudokuDifficulty,
  SudokuHistoryEntry,
  SudokuHistoryKind,
  SudokuMode,
  SudokuState,
  SudokuStatsSnapshot,
} from './types';

export const SUDOKU_STATE_SCHEMA_VERSION = 1;

interface SerializedSudokuEnvelope {
  readonly schemaVersion: number;
  readonly state: SudokuState;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSudokuDifficulty(value: unknown): value is SudokuDifficulty {
  return value === 'easy' || value === 'medium' || value === 'hard';
}

function isSudokuMode(value: unknown): value is SudokuMode {
  return value === 'standard' || value === 'daily';
}

function isSudokuHistoryKind(value: unknown): value is SudokuHistoryKind {
  return (
    value === 'PLACE_DIGIT' ||
    value === 'CLEAR_CELL' ||
    value === 'TOGGLE_NOTE' ||
    value === 'APPLY_HINT_STEP'
  );
}

function isPuzzleRecord(value: unknown): value is PuzzleRecord {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.seed === 'number' &&
    Number.isFinite(value.seed) &&
    typeof value.engineVersion === 'string' &&
    isSudokuDifficulty(value.difficulty) &&
    Array.isArray(value.techniquesRequired) &&
    value.techniquesRequired.every((t) => typeof t === 'string') &&
    typeof value.clues === 'string' &&
    value.clues.length === BOARD_SIZE &&
    typeof value.solution === 'string' &&
    value.solution.length === BOARD_SIZE
  );
}

function isValidMask(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    (value & ~ALL_DIGITS_MASK) === 0
  );
}

function isSudokuCell(value: unknown): value is SudokuCell {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.value === 'number' &&
    Number.isInteger(value.value) &&
    value.value >= 0 &&
    value.value <= 9 &&
    typeof value.given === 'boolean' &&
    isValidMask(value.manualNotes) &&
    isValidMask(value.autoShowExcluded) &&
    isValidMask(value.autoShowAdded)
  );
}

function isCellChange(value: unknown): value is CellChange {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.cell === 'number' &&
    Number.isInteger(value.cell) &&
    value.cell >= 0 &&
    value.cell < BOARD_SIZE &&
    typeof value.prevValue === 'number' &&
    typeof value.nextValue === 'number' &&
    isValidMask(value.prevManualNotes) &&
    isValidMask(value.nextManualNotes) &&
    isValidMask(value.prevAutoShowExcluded) &&
    isValidMask(value.nextAutoShowExcluded) &&
    isValidMask(value.prevAutoShowAdded) &&
    isValidMask(value.nextAutoShowAdded)
  );
}

function isSudokuHistoryEntry(value: unknown): value is SudokuHistoryEntry {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    value.id >= 1 &&
    isSudokuHistoryKind(value.kind) &&
    typeof value.timestampMs === 'number' &&
    Number.isFinite(value.timestampMs) &&
    (value.autoShowSession === null ||
      (typeof value.autoShowSession === 'number' && Number.isInteger(value.autoShowSession))) &&
    Array.isArray(value.changes) &&
    value.changes.every(isCellChange)
  );
}

export function serializeSudokuState(state: SudokuState): string {
  const envelope: SerializedSudokuEnvelope = {
    schemaVersion: SUDOKU_STATE_SCHEMA_VERSION,
    state,
  };
  return JSON.stringify(envelope);
}

export function deserializeSudokuState(raw: string): SudokuState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Serialized Sudoku state is not valid JSON.');
  }

  if (!isObject(parsed) || parsed.schemaVersion !== SUDOKU_STATE_SCHEMA_VERSION) {
    throw new Error('Unsupported or missing Sudoku state schemaVersion.');
  }

  const candidate = parsed.state;
  if (!isObject(candidate)) {
    throw new Error('Serialized Sudoku state is missing state object.');
  }

  if (
    !isPuzzleRecord(candidate.puzzle) ||
    !isSudokuMode(candidate.mode) ||
    (candidate.dailyDate !== undefined && typeof candidate.dailyDate !== 'string') ||
    !Array.isArray(candidate.cells) ||
    candidate.cells.length !== BOARD_SIZE ||
    !candidate.cells.every(isSudokuCell) ||
    typeof candidate.autoShowEnabled !== 'boolean' ||
    typeof candidate.autoShowSession !== 'number' ||
    !Number.isInteger(candidate.autoShowSession) ||
    typeof candidate.notesMode !== 'boolean' ||
    (candidate.selectedCell !== null &&
      (typeof candidate.selectedCell !== 'number' ||
        !Number.isInteger(candidate.selectedCell) ||
        candidate.selectedCell < 0 ||
        candidate.selectedCell >= BOARD_SIZE)) ||
    !Array.isArray(candidate.checkedWrongCells) ||
    !candidate.checkedWrongCells.every(
      (idx) => typeof idx === 'number' && Number.isInteger(idx) && idx >= 0 && idx < BOARD_SIZE,
    ) ||
    typeof candidate.elapsedMs !== 'number' ||
    !Number.isFinite(candidate.elapsedMs) ||
    candidate.elapsedMs < 0 ||
    typeof candidate.paused !== 'boolean' ||
    typeof candidate.completed !== 'boolean' ||
    typeof candidate.hintsUsed !== 'number' ||
    !Number.isInteger(candidate.hintsUsed) ||
    candidate.hintsUsed < 0 ||
    typeof candidate.hintViewedForCurrentBoard !== 'boolean' ||
    !Array.isArray(candidate.history) ||
    !candidate.history.every(isSudokuHistoryEntry) ||
    typeof candidate.historyCursor !== 'number' ||
    !Number.isInteger(candidate.historyCursor) ||
    candidate.historyCursor < 0 ||
    candidate.historyCursor > candidate.history.length ||
    typeof candidate.nextHistoryId !== 'number' ||
    !Number.isInteger(candidate.nextHistoryId) ||
    candidate.nextHistoryId < 1
  ) {
    throw new Error('Serialized Sudoku state failed structural validation.');
  }

  return candidate as unknown as SudokuState;
}

export function extractSudokuStats(state: SudokuState): SudokuStatsSnapshot {
  return {
    gamesStarted: 1,
    gamesWon: state.completed ? 1 : 0,
    totalPlayMs: state.elapsedMs,
    difficulty: state.puzzle.difficulty,
    mode: state.mode,
    hintsUsed: state.hintsUsed,
    completed: state.completed,
  };
}

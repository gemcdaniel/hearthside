import type { BaseGameStats, GameEvent } from '@hearthside/game-core';

export type SudokuDifficulty = 'easy' | 'medium' | 'hard';
export type SudokuMode = 'standard' | 'daily';

export interface PuzzleRecord {
  readonly id: string;
  readonly seed: number;
  readonly engineVersion: string;
  readonly difficulty: SudokuDifficulty;
  readonly techniquesRequired: readonly string[];
  readonly clues: string;
  readonly solution: string;
}

export interface StarterBankCounts {
  readonly easy: number;
  readonly medium: number;
  readonly hard: number;
}

export interface StarterPuzzleBank {
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly seedStart: number;
  readonly counts: StarterBankCounts;
  readonly puzzles: readonly PuzzleRecord[];
}

export interface SudokuCell {
  /** Current placed digit (0 for empty, 1..9 for filled). */
  readonly value: number;
  /** True when the cell is an immutable initial clue. */
  readonly given: boolean;
  /** 9-bit bitmask (bits 1<<1..1<<9) storing player manual candidate notes (D8/D12). */
  readonly manualNotes: number;
  /** 9-bit bitmask of candidates explicitly excluded while auto-show is ON (D20). */
  readonly autoShowExcluded: number;
  /** 9-bit bitmask of candidates explicitly added while auto-show is ON (D20). */
  readonly autoShowAdded: number;
}

export interface SudokuPlacement {
  readonly cell: number;
  readonly digit: number;
}

export interface SudokuElimination {
  readonly cell: number;
  readonly digit: number;
}

export interface CellChange {
  readonly cell: number;
  readonly prevValue: number;
  readonly nextValue: number;
  readonly prevManualNotes: number;
  readonly nextManualNotes: number;
  readonly prevAutoShowExcluded: number;
  readonly nextAutoShowExcluded: number;
  readonly prevAutoShowAdded: number;
  readonly nextAutoShowAdded: number;
}

export type SudokuHistoryKind = 'PLACE_DIGIT' | 'CLEAR_CELL' | 'TOGGLE_NOTE' | 'APPLY_HINT_STEP';

export interface SudokuHistoryEntry {
  readonly id: number;
  readonly kind: SudokuHistoryKind;
  readonly timestampMs: number;
  /** Session ID when created via an auto-show overlay edit, or null otherwise. */
  readonly autoShowSession: number | null;
  readonly changes: readonly CellChange[];
}

export interface SudokuState {
  readonly puzzle: PuzzleRecord;
  readonly mode: SudokuMode;
  readonly dailyDate?: string;
  readonly cells: readonly SudokuCell[];
  readonly autoShowEnabled: boolean;
  readonly autoShowSession: number;
  readonly notesMode: boolean;
  readonly selectedCell: number | null;
  readonly checkedWrongCells: readonly number[];
  readonly elapsedMs: number;
  readonly paused: boolean;
  readonly completed: boolean;
  readonly hintsUsed: number;
  readonly hintViewedForCurrentBoard: boolean;
  readonly history: readonly SudokuHistoryEntry[];
  readonly historyCursor: number;
  readonly nextHistoryId: number;
}

export type PlaceDigitEvent = GameEvent<'PLACE_DIGIT', { readonly cell: number; readonly digit: number }>;
export type ClearCellEvent = GameEvent<'CLEAR_CELL', { readonly cell: number }>;
export type ToggleNoteEvent = GameEvent<'TOGGLE_NOTE', { readonly cell: number; readonly digit: number }>;
export type ApplyHintStepEvent = GameEvent<
  'APPLY_HINT_STEP',
  {
    readonly placements: readonly SudokuPlacement[];
    readonly eliminations: readonly SudokuElimination[];
  }
>;
export type UndoEvent = GameEvent<'UNDO', undefined>;
export type RedoEvent = GameEvent<'REDO', undefined>;
export type SelectCellEvent = GameEvent<'SELECT_CELL', { readonly cell: number | null }>;
export type ToggleNotesModeEvent = GameEvent<'TOGGLE_NOTES_MODE', undefined>;
export type ToggleAutoShowEvent = GameEvent<'TOGGLE_AUTO_SHOW', undefined>;
export type SetPausedEvent = GameEvent<'SET_PAUSED', { readonly paused: boolean }>;
export type TickTimerEvent = GameEvent<'TICK_TIMER', { readonly deltaMs: number }>;
export type CheckBoardEvent = GameEvent<'CHECK_BOARD', undefined>;
export type ClearCheckBoardEvent = GameEvent<'CLEAR_CHECK_BOARD', undefined>;
export type RecordHintViewedEvent = GameEvent<'RECORD_HINT_VIEWED', undefined>;

export type SudokuEvent =
  | PlaceDigitEvent
  | ClearCellEvent
  | ToggleNoteEvent
  | ApplyHintStepEvent
  | UndoEvent
  | RedoEvent
  | SelectCellEvent
  | ToggleNotesModeEvent
  | ToggleAutoShowEvent
  | SetPausedEvent
  | TickTimerEvent
  | CheckBoardEvent
  | ClearCheckBoardEvent
  | RecordHintViewedEvent;

export interface HighlightMap {
  readonly selected: number | null;
  readonly peers: readonly number[];
  readonly sameDigit: readonly number[];
}

export interface SudokuStatsSnapshot extends BaseGameStats {
  readonly difficulty: SudokuDifficulty;
  readonly mode: SudokuMode;
  readonly hintsUsed: number;
  readonly completed: boolean;
}

export { sudokuMetadata } from './metadata';
export {
  ALL_DIGITS_MASK,
  BOARD_SIZE,
  BOXES,
  BOX_OF,
  BOX_SIZE,
  COLS,
  COL_OF,
  GRID_SIZE,
  PEERS,
  ROWS,
  ROW_OF,
  digitBit,
  digitsToMask,
  hasDigitBit,
  isValidCellIndex,
  isValidDigit,
  maskToDigits,
  parseBoardDigits,
} from './engine/boardMath';
export { sudokuPlugin } from './engine/plugin';
export {
  clearNonGivenCount,
  createSudokuState,
  reduceSudoku,
  sudokuActions,
  type CreateSudokuStateOptions,
} from './engine/reducer';
export {
  canRedo,
  canUndo,
  getComputedCandidates,
  getDuplicateConflicts,
  getHighlightMap,
  getPeerPlacedMask,
  getRemainingDigitCounts,
  getVisibleNotes,
  getWrongValueCells,
  isHistoryEntryActive,
  isPuzzleSolved,
} from './engine/selectors';
export {
  SUDOKU_STATE_SCHEMA_VERSION,
  deserializeSudokuState,
  extractSudokuStats,
  serializeSudokuState,
} from './engine/serialization';
export {
  getStarterBank,
  getStarterPuzzle,
  getStarterPuzzlesByDifficulty,
  pickNextStarterPuzzle,
} from './engine/starterBank';
export type {
  ApplyHintStepEvent,
  CellChange,
  CheckBoardEvent,
  ClearCellEvent,
  ClearCheckBoardEvent,
  HighlightMap,
  PlaceDigitEvent,
  PuzzleRecord,
  RecordHintViewedEvent,
  RedoEvent,
  SelectCellEvent,
  SetPausedEvent,
  StarterBankCounts,
  StarterPuzzleBank,
  SudokuCell,
  SudokuDifficulty,
  SudokuElimination,
  SudokuEvent,
  SudokuHistoryEntry,
  SudokuHistoryKind,
  SudokuMode,
  SudokuPlacement,
  SudokuState,
  SudokuStatsSnapshot,
  TickTimerEvent,
  ToggleAutoShowEvent,
  ToggleNoteEvent,
  ToggleNotesModeEvent,
  UndoEvent,
} from './engine/types';
export { SudokuBoard, type SudokuBoardProps } from './ui/SudokuBoard';
export { SudokuControls, type SudokuControlsProps } from './ui/SudokuControls';
export { SudokuGame, type SudokuGameProps } from './ui/SudokuGame';
export { formatElapsedTime } from './ui/formatTime';

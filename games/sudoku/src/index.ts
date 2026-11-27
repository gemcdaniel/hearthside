export { sudokuMetadata } from './metadata';
export {
  STARTER_OVERFLOW_SEED_BASE,
  SUDOKU_ENGINE_VERSION,
  computeDailySeed,
  computeOverflowSeed,
  dailyCacheKey,
  dailySlotKey,
  getLocalDateString,
  isSudokuDifficulty,
  isValidDateKey,
  parseSudokuLaunchMode,
  type ParsedSudokuLaunch,
} from './engine/daily';
export {
  TECHNIQUE_GUIDES,
  advanceActiveHint,
  boardToDigitsString,
  createActiveHintFromResponse,
  formatCellCoord,
  formatHintTierMessage,
  formatRegionLabel,
  getRegionCells,
  getTechniqueGuide,
  getTier1Region,
  type ActiveHintState,
  type HintRegion,
  type HintStatus,
  type HintStep,
  type SudokuHintResponse,
  type TechniqueGuide,
} from './engine/hints';
export {
  SUDOKU_STATS_SCHEMA_VERSION,
  computeDailyStreaks,
  createEmptySudokuStats,
  getAverageTimeMs,
  getWinRatePercent,
  normalizeSudokuStats,
  recordGameStarted,
  recordGameWon,
  type DifficultyStats,
  type RecordGameWonInput,
  type SudokuProfileStats,
} from './engine/stats';
export { getDefaultSudokuWasmClient, type SudokuWasmClient } from './wasm/sudokuWasmClient';
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
export { SudokuLibraryExtras } from './ui/SudokuLibraryExtras';
export { SudokuStatsModal, type SudokuStatsModalProps } from './ui/SudokuStatsModal';
export { SudokuVictoryModal, type SudokuVictoryModalProps } from './ui/SudokuVictoryModal';
export { formatElapsedTime } from './ui/formatTime';

import type { GamePlugin } from '@hearthside/game-core';
import { sudokuMetadata } from '../metadata';
import { createSudokuState, reduceSudoku } from './reducer';
import {
  SUDOKU_STATE_SCHEMA_VERSION,
  deserializeSudokuState,
  extractSudokuStats,
  serializeSudokuState,
} from './serialization';
import { getStarterPuzzle } from './starterBank';
import type { SudokuEvent, SudokuState, SudokuStatsSnapshot } from './types';

export const sudokuPlugin: GamePlugin<SudokuState, SudokuEvent, SudokuStatsSnapshot> = {
  metadata: sudokuMetadata,
  schemaVersion: SUDOKU_STATE_SCHEMA_VERSION,
  createInitialState: () => createSudokuState(getStarterPuzzle('easy', 0)),
  reduce: reduceSudoku,
  serializeState: serializeSudokuState,
  deserializeState: deserializeSudokuState,
  extractStats: extractSudokuStats,
};

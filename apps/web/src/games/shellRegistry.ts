import {
  createGameRegistry,
  type GameLibraryExtrasProps,
  type GamePluginDescriptor,
  type PuzzleRecordLogEntry,
  type SaveSummaryMetadata,
  type ShellServices,
} from '@hearthside/game-core';
import {
  SUDOKU_STATS_SCHEMA_VERSION,
  SudokuGame,
  SudokuLibraryExtras,
  normalizeSudokuStats,
  parseSudokuLaunchMode,
  recomputeSudokuStatsFromRecords,
  sudokuPlugin,
} from '@hearthside/game-sudoku';
import type { ComponentType } from 'react';

export interface GameMountProps {
  readonly services: ShellServices;
  readonly initialMode?: string;
}

export interface ShellGameEntry extends GamePluginDescriptor {
  readonly Component: ComponentType<GameMountProps>;
  readonly LibraryExtras?: ComponentType<GameLibraryExtrasProps>;
  readonly resolveSlot?: (modeId?: string) => string;
  readonly extractSaveSummary?: (payload: unknown) => SaveSummaryMetadata | null;
  readonly recomputeStats?: (
    records: readonly PuzzleRecordLogEntry[],
    legacyBaseline?: unknown,
  ) => { readonly schemaVersion: number; readonly stats: unknown };
}

export const shellGameRegistry = createGameRegistry<ShellGameEntry>();
shellGameRegistry.register({
  metadata: sudokuPlugin.metadata,
  schemaVersion: sudokuPlugin.schemaVersion,
  Component: SudokuGame,
  LibraryExtras: SudokuLibraryExtras,
  resolveSlot: (modeId) => parseSudokuLaunchMode(modeId).slot,
  extractSaveSummary: (payload) => {
    if (typeof payload !== 'string') {
      return null;
    }
    try {
      const state = sudokuPlugin.deserializeState(payload);
      return sudokuPlugin.extractSaveSummary(state);
    } catch {
      return null;
    }
  },
  recomputeStats: (records, legacyBaseline) => ({
    schemaVersion: SUDOKU_STATS_SCHEMA_VERSION,
    stats: recomputeSudokuStatsFromRecords(
      records,
      legacyBaseline !== undefined ? normalizeSudokuStats(legacyBaseline) : undefined,
    ),
  }),
});

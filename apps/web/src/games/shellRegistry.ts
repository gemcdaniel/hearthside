import {
  createGameRegistry,
  type GameLibraryExtrasProps,
  type GamePluginDescriptor,
  type ShellServices,
} from '@hearthside/game-core';
import { SudokuGame, SudokuLibraryExtras, sudokuPlugin } from '@hearthside/game-sudoku';
import type { ComponentType } from 'react';

export interface GameMountProps {
  readonly services: ShellServices;
  readonly initialMode?: string;
}

export interface ShellGameEntry extends GamePluginDescriptor {
  readonly Component: ComponentType<GameMountProps>;
  readonly LibraryExtras?: ComponentType<GameLibraryExtrasProps>;
}

export const shellGameRegistry = createGameRegistry<ShellGameEntry>();
shellGameRegistry.register({
  metadata: sudokuPlugin.metadata,
  schemaVersion: sudokuPlugin.schemaVersion,
  Component: SudokuGame,
  LibraryExtras: SudokuLibraryExtras,
});

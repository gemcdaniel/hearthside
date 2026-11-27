import {
  createGameRegistry,
  type GamePluginDescriptor,
  type ShellServices,
} from '@hearthside/game-core';
import type { ComponentType } from 'react';
import { placeholderSudokuEntry } from './placeholderSudokuPlugin';

export interface GameMountProps {
  readonly services: ShellServices;
  readonly initialMode?: string;
}

export interface ShellGameEntry extends GamePluginDescriptor {
  readonly Component: ComponentType<GameMountProps>;
}

export const shellGameRegistry = createGameRegistry<ShellGameEntry>();
shellGameRegistry.register(placeholderSudokuEntry);

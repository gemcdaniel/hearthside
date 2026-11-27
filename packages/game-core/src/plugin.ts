import type { AudioService } from './audio';
import type { Profile, ProfileSettings } from './profile';
import type { GameStorageService } from './storage';

export type GameCategory = 'puzzle' | 'card' | 'board' | 'arcade';

export interface GameModeDescriptor {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
}

export interface GameMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: GameCategory;
  readonly icon: string;
  readonly supportedModes: readonly GameModeDescriptor[];
  readonly supportsOffline: boolean;
}

export interface GameEvent<TType extends string = string, TPayload = unknown> {
  readonly type: TType;
  readonly payload: TPayload;
  readonly timestampMs: number;
}

export type GameReducer<TState, TEvent extends GameEvent> = (
  state: TState,
  event: TEvent,
) => TState;

export interface GamePluginDescriptor {
  readonly metadata: GameMetadata;
  readonly schemaVersion: number;
}

export interface GamePlugin<
  TState = unknown,
  TEvent extends GameEvent = GameEvent,
  TStats = unknown,
> extends GamePluginDescriptor {
  readonly createInitialState: () => TState;
  readonly reduce: GameReducer<TState, TEvent>;
  readonly serializeState: (state: TState) => string;
  readonly deserializeState: (raw: string) => TState;
  readonly extractStats: (state: TState) => TStats;
}

export interface ShellServices {
  readonly activeProfile: Profile;
  readonly settings: ProfileSettings;
  readonly storage: GameStorageService;
  readonly audio: AudioService;
  readonly onExitToLibrary: () => void;
}

export interface GameMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
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

export interface GamePlugin<TState, TEvent extends GameEvent> {
  readonly metadata: GameMetadata;
  readonly createInitialState: () => TState;
  readonly reduce: GameReducer<TState, TEvent>;
  readonly serializeState: (state: TState) => string;
  readonly deserializeState: (raw: string) => TState;
}

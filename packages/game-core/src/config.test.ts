import { describe, expect, it } from 'vitest';
import { APP_DISPLAY_NAME, APP_VERSION, type GameEvent, type GameReducer } from './index';

describe('game-core config & plugin contract', () => {
  it('exposes the centralized Hearthside display name and version', () => {
    expect(APP_DISPLAY_NAME).toBe('Hearthside');
    expect(APP_VERSION).toBe('1.0.0');
  });

  it('supports deterministic pure event reducers', () => {
    type CounterEvent = GameEvent<'increment', number>;
    const reducer: GameReducer<{ count: number }, CounterEvent> = (state, event) => ({
      count: state.count + event.payload,
    });

    const initial = { count: 0 };
    const next = reducer(initial, { type: 'increment', payload: 2, timestampMs: 1 });
    expect(next).toEqual({ count: 2 });
    expect(initial).toEqual({ count: 0 });
  });
});

import { describe, expect, it } from 'vitest';
import {
  AUDIO_CUES,
  AVATAR_IDS,
  DEFAULT_SUDOKU_SETTINGS,
  PROFILE_ACCENT_IDS,
  createDefaultProfileSettings,
  createGameRegistry,
  isAudioCue,
  isAvatarId,
  isColorMode,
  isProfileAccentId,
  isThemeId,
  type GameEvent,
  type GamePlugin,
} from './index';

interface CounterState {
  readonly count: number;
}

type CounterEvent = GameEvent<'inc', number>;

interface CounterStats {
  readonly total: number;
}

function makeTestPlugin(
  id: string,
  name: string,
): GamePlugin<CounterState, CounterEvent, CounterStats> {
  return {
    schemaVersion: 1,
    metadata: {
      id,
      name,
      description: 'Test plugin',
      category: 'puzzle',
      icon: 'grid',
      supportedModes: [{ id: 'standard', label: 'Standard' }],
      supportsOffline: true,
    },
    createInitialState: () => ({ count: 0 }),
    reduce: (state, event) => ({ count: state.count + event.payload }),
    serializeState: (state) => JSON.stringify(state),
    deserializeState: (raw) => JSON.parse(raw) as CounterState,
    extractStats: (state) => ({ total: state.count }),
    extractSaveSummary: (state) => ({
      puzzleId: 'counter-1',
      completed: state.count > 0,
      elapsedMs: 0,
      filledCells: state.count,
    }),
  };
}

describe('packages/game-core registry and profile defaults', () => {
  it('registers, retrieves, lists, and unregisters plugins while rejecting duplicates', () => {
    const registry = createGameRegistry();
    const sudoku = makeTestPlugin('sudoku', 'Sudoku');
    const solitaire = makeTestPlugin('solitaire', 'Solitaire');

    registry.register(sudoku);
    registry.register(solitaire);

    expect(registry.has('sudoku')).toBe(true);
    expect(registry.get('sudoku')).toBe(sudoku);
    expect(registry.list()).toHaveLength(2);
    expect(registry.listMetadata().map((m) => m.id)).toEqual(['sudoku', 'solitaire']);

    expect(() => registry.register(makeTestPlugin('sudoku', 'Duplicate'))).toThrow(/already/);
    expect(() => registry.register(makeTestPlugin('   ', 'Blank'))).toThrow(/non-empty/);

    expect(registry.unregister('solitaire')).toBe(true);
    expect(registry.unregister('solitaire')).toBe(false);
    expect(registry.list()).toHaveLength(1);
  });

  it('provides D21 defaults and strict runtime type guards', () => {
    expect(DEFAULT_SUDOKU_SETTINGS).toEqual({
      flagDuplicateConflicts: true,
      flagWrongValues: false,
    });

    const defaults = createDefaultProfileSettings('dark');
    expect(defaults).toEqual({
      theme: 'clean-minimal',
      mode: 'dark',
      sfxEnabled: true,
      sfxVolume: 0.7,
      musicEnabled: false,
      musicVolume: 0.4,
      sudoku: {
        flagDuplicateConflicts: true,
        flagWrongValues: false,
      },
    });

    expect(isThemeId('clean-minimal')).toBe(true);
    expect(isThemeId('warm-hearthside')).toBe(true);
    expect(isThemeId('other')).toBe(false);

    expect(isColorMode('light')).toBe(true);
    expect(isColorMode('dark')).toBe(true);
    expect(isColorMode('sepia')).toBe(false);

    for (const cue of AUDIO_CUES) {
      expect(isAudioCue(cue)).toBe(true);
    }
    expect(isAudioCue('explosion')).toBe(false);

    for (const avatar of AVATAR_IDS) {
      expect(isAvatarId(avatar)).toBe(true);
    }
    expect(isAvatarId('robot')).toBe(false);

    for (const accent of PROFILE_ACCENT_IDS) {
      expect(isProfileAccentId(accent)).toBe(true);
    }
    expect(isProfileAccentId('neon-pink')).toBe(false);
  });
});

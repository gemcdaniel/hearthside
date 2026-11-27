import type { GameEvent, GamePlugin } from '@hearthside/game-core';
import { PlaceholderGrid } from '../components/PlaceholderGrid';
import type { GameMountProps, ShellGameEntry } from './shellRegistry';

interface PlaceholderSudokuState {
  readonly mode: string;
}

type PlaceholderSudokuEvent = GameEvent<'select_mode', string>;

interface PlaceholderSudokuStats {
  readonly gamesStarted: number;
}

export const placeholderSudokuPlugin: GamePlugin<
  PlaceholderSudokuState,
  PlaceholderSudokuEvent,
  PlaceholderSudokuStats
> = {
  schemaVersion: 1,
  metadata: {
    id: 'sudoku',
    name: 'Sudoku',
    description: 'Classic 9x9 logic puzzle with smart notes and progressive hints.',
    category: 'puzzle',
    icon: 'sudoku-grid',
    supportedModes: [
      { id: 'continue', label: 'Continue' },
      { id: 'daily', label: 'Daily Puzzle' },
      { id: 'new', label: 'New Game' },
    ],
    supportsOffline: true,
  },
  createInitialState: () => ({ mode: 'new' }),
  reduce: (state, event) => (event.type === 'select_mode' ? { mode: event.payload } : state),
  serializeState: (state) => JSON.stringify(state),
  deserializeState: (raw) => JSON.parse(raw) as PlaceholderSudokuState,
  extractStats: () => ({ gamesStarted: 0 }),
};

function PlaceholderSudokuMount({ services, initialMode }: GameMountProps) {
  const modeLabel =
    placeholderSudokuPlugin.metadata.supportedModes.find((m) => m.id === initialMode)?.label ??
    'Puzzle Board';

  function handleExit() {
    services.audio.playSfx('tap');
    services.onExitToLibrary();
  }

  return (
    <div className="hs-game-view">
      <div className="hs-game-toolbar">
        <button type="button" className="hs-btn hs-btn-secondary" onClick={handleExit}>
          Back to Library
        </button>
        <div className="hs-game-meta">
          <span className="hs-badge" data-tone="success">
            {modeLabel}
          </span>
          <span className="hs-game-profile-note">
            Playing as {services.activeProfile.name} (Conflicts:{' '}
            {services.settings.sudoku.flagDuplicateConflicts ? 'On' : 'Off'}, Wrong check:{' '}
            {services.settings.sudoku.flagWrongValues ? 'On' : 'Off'})
          </span>
        </div>
      </div>

      <PlaceholderGrid />
    </div>
  );
}

export const placeholderSudokuEntry: ShellGameEntry = {
  metadata: placeholderSudokuPlugin.metadata,
  schemaVersion: placeholderSudokuPlugin.schemaVersion,
  Component: PlaceholderSudokuMount,
};

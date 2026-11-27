import { sudokuPlugin } from '@hearthside/game-sudoku';
import { PlaceholderGrid } from '../components/PlaceholderGrid';
import type { GameMountProps, ShellGameEntry } from './shellRegistry';

function PlaceholderSudokuMount({ services, initialMode }: GameMountProps) {
  const modeLabel =
    sudokuPlugin.metadata.supportedModes.find((m) => m.id === initialMode)?.label ?? 'Puzzle Board';

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
  metadata: sudokuPlugin.metadata,
  schemaVersion: sudokuPlugin.schemaVersion,
  Component: PlaceholderSudokuMount,
};

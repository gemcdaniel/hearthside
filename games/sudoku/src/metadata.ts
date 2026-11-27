import type { GameMetadata } from '@hearthside/game-core';

export const sudokuMetadata: GameMetadata = {
  id: 'sudoku',
  name: 'Sudoku',
  description: 'Classic 9x9 logic puzzle',
  category: 'puzzle',
  icon: 'sudoku-grid',
  supportedModes: [
    { id: 'continue', label: 'Continue', description: 'Resume an in-progress puzzle' },
    { id: 'daily', label: 'Daily Puzzle', description: 'Today’s offline challenge' },
    { id: 'new', label: 'New Game', description: 'Pick Easy, Medium, or Hard' },
  ],
  supportsOffline: true,
};

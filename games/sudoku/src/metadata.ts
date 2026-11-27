import type { GameMetadata } from '@hearthside/game-core';

export const sudokuMetadata: GameMetadata = {
  id: 'sudoku',
  name: 'Sudoku',
  description: 'Classic 9x9 logic puzzle with smart notes and progressive hints.',
  category: 'puzzle',
  icon: 'sudoku-grid',
  supportedModes: [
    { id: 'easy', label: 'Easy', description: 'Naked & hidden singles' },
    { id: 'medium', label: 'Medium', description: 'Pairs, triples & line reductions' },
    { id: 'hard', label: 'Hard', description: 'X-Wing, Wings & Swordfish' },
  ],
  supportsOffline: true,
};

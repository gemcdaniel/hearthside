import rawStarterBank from '../data/starter-bank.json';
import type { PuzzleRecord, StarterPuzzleBank, SudokuDifficulty } from './types';

const starterBank = rawStarterBank as StarterPuzzleBank;

export function getStarterBank(): StarterPuzzleBank {
  return starterBank;
}

export function getStarterPuzzlesByDifficulty(
  difficulty: SudokuDifficulty,
): readonly PuzzleRecord[] {
  return starterBank.puzzles.filter((puzzle) => puzzle.difficulty === difficulty);
}

export function getStarterPuzzle(difficulty: SudokuDifficulty, index = 0): PuzzleRecord {
  const tierPuzzles = getStarterPuzzlesByDifficulty(difficulty);
  const found = tierPuzzles[index] ?? tierPuzzles[0];
  if (!found) {
    throw new Error(`Starter bank has no puzzles for difficulty "${difficulty}".`);
  }
  return found;
}

export function pickNextStarterPuzzle(
  difficulty: SudokuDifficulty,
  completedIds: ReadonlySet<string>,
): PuzzleRecord | null {
  const tierPuzzles = getStarterPuzzlesByDifficulty(difficulty);
  for (const puzzle of tierPuzzles) {
    if (!completedIds.has(puzzle.id)) {
      return puzzle;
    }
  }
  return null;
}

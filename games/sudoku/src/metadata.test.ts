import { describe, expect, it } from 'vitest';
import { sudokuMetadata } from './index';

describe('sudoku game metadata', () => {
  it('declares offline-capable Sudoku metadata', () => {
    expect(sudokuMetadata.id).toBe('sudoku');
    expect(sudokuMetadata.name).toBe('Sudoku');
    expect(sudokuMetadata.category).toBe('puzzle');
    expect(sudokuMetadata.icon).toBe('sudoku-grid');
    expect(sudokuMetadata.supportedModes.map((m) => m.id)).toEqual(['easy', 'medium', 'hard']);
    expect(sudokuMetadata.supportsOffline).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { sudokuMetadata } from './index';

describe('sudoku game metadata', () => {
  it('declares offline-capable Sudoku metadata', () => {
    expect(sudokuMetadata.id).toBe('sudoku');
    expect(sudokuMetadata.name).toBe('Sudoku');
    expect(sudokuMetadata.supportsOffline).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import {
  STARTER_OVERFLOW_SEED_BASE,
  computeDailySeed,
  computeOverflowSeed,
  dailyCacheKey,
  dailySlotKey,
  getLocalDateString,
  parseSudokuLaunchMode,
} from './daily';

describe('Sudoku deterministic daily & overflow seeds (D22)', () => {
  it('computes identical 53-bit-safe positive integer seeds for the same date, difficulty, and version', () => {
    const seedA = computeDailySeed('2026-11-27', 'medium', '0.1.0-dev');
    const seedB = computeDailySeed('2026-11-27', 'medium', '0.1.0-dev');
    const seedOtherDay = computeDailySeed('2026-11-28', 'medium', '0.1.0-dev');
    const seedOtherDiff = computeDailySeed('2026-11-27', 'hard', '0.1.0-dev');
    const seedOtherVer = computeDailySeed('2026-11-27', 'medium', '0.2.0');

    expect(seedA).toBe(seedB);
    expect(Number.isSafeInteger(seedA)).toBe(true);
    expect(seedA).toBeGreaterThanOrEqual(1);
    expect(seedA).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(seedA).not.toBe(seedOtherDay);
    expect(seedA).not.toBe(seedOtherDiff);
    expect(seedA).not.toBe(seedOtherVer);
  });

  it('computes deterministic overflow seeds strictly above starter-bank range', () => {
    const s0 = computeOverflowSeed('easy', 0, '0.1.0-dev');
    const s0Repeat = computeOverflowSeed('easy', 0, '0.1.0-dev');
    const s1 = computeOverflowSeed('easy', 1, '0.1.0-dev');

    expect(s0).toBe(s0Repeat);
    expect(s0).not.toBe(s1);
    expect(s0).toBeGreaterThanOrEqual(STARTER_OVERFLOW_SEED_BASE);
    expect(Number.isSafeInteger(s0)).toBe(true);
  });

  it('formats local calendar dates and parses daily vs standard launch modes cleanly', () => {
    const sample = new Date(2026, 10, 27, 23, 30, 0);
    expect(getLocalDateString(sample)).toBe('2026-11-27');

    expect(dailySlotKey('2026-11-27', 'hard')).toBe('daily:2026-11-27:hard');
    expect(dailyCacheKey('2026-11-27', 'hard', '0.1.0-dev')).toBe(
      'daily:2026-11-27:hard:0.1.0-dev',
    );

    expect(parseSudokuLaunchMode('medium', '2026-11-27')).toEqual({
      mode: 'standard',
      difficulty: 'medium',
      slot: 'medium',
    });

    expect(parseSudokuLaunchMode('daily:hard', '2026-11-27')).toEqual({
      mode: 'daily',
      difficulty: 'hard',
      dailyDate: '2026-11-27',
      slot: 'daily:2026-11-27:hard',
    });

    expect(parseSudokuLaunchMode('daily:2026-11-25:medium', '2026-11-27')).toEqual({
      mode: 'daily',
      difficulty: 'medium',
      dailyDate: '2026-11-25',
      slot: 'daily:2026-11-25:medium',
    });
  });
});

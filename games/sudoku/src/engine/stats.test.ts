import { describe, expect, it } from 'vitest';
import {
  computeDailyStreaks,
  createEmptySudokuStats,
  getAverageTimeMs,
  getWinRatePercent,
  recordGameStarted,
  recordGameWon,
} from './stats';

describe('Sudoku per-profile stats and daily streaks', () => {
  it('tracks games started, wins, personal bests, average times, and win rate', () => {
    let stats = createEmptySudokuStats();
    stats = recordGameStarted(stats, 'easy');
    stats = recordGameStarted(stats, 'easy');

    const win1 = recordGameWon(stats, {
      difficulty: 'easy',
      mode: 'standard',
      elapsedMs: 90_000,
      hintsUsed: 2,
    });
    expect(win1.isNewPersonalBest).toBe(true);
    stats = win1.stats;

    // Slower second solve is NOT a new personal best, average updates cleanly
    const win2 = recordGameWon(stats, {
      difficulty: 'easy',
      mode: 'standard',
      elapsedMs: 110_000,
      hintsUsed: 0,
    });
    expect(win2.isNewPersonalBest).toBe(false);
    stats = win2.stats;

    expect(stats.gamesStarted).toBe(2);
    expect(stats.gamesWon).toBe(2);
    expect(getWinRatePercent(stats)).toBe(100);
    expect(stats.byDifficulty.easy.bestTimeMs).toBe(90_000);
    expect(getAverageTimeMs(stats.byDifficulty.easy)).toBe(100_000);
    expect(stats.totalHintsUsed).toBe(2);

    // Faster third solve sets a new personal best
    const win3 = recordGameWon(stats, {
      difficulty: 'easy',
      mode: 'standard',
      elapsedMs: 75_000,
      hintsUsed: 1,
    });
    expect(win3.isNewPersonalBest).toBe(true);
    expect(win3.stats.byDifficulty.easy.bestTimeMs).toBe(75_000);
  });

  it('computes consecutive daily streaks accurately across gaps and month boundaries', () => {
    // Active streak continuing from yesterday even before solving today
    expect(computeDailyStreaks(['2026-10-30', '2026-10-31', '2026-11-01'], '2026-11-02')).toEqual({
      current: 3,
      best: 3,
    });

    // Duplicate same-day entries count once, and a gap resets current streak while preserving best
    expect(
      computeDailyStreaks(
        ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-03', '2026-11-26', '2026-11-27'],
        '2026-11-27',
      ),
    ).toEqual({
      current: 2,
      best: 3,
    });

    // Solving nothing for 2+ days resets current streak to 0
    expect(computeDailyStreaks(['2026-11-20', '2026-11-21'], '2026-11-25')).toEqual({
      current: 0,
      best: 2,
    });
  });

  it('records daily completions and updates streaks inside recordGameWon', () => {
    let stats = createEmptySudokuStats();
    stats = recordGameWon(stats, {
      difficulty: 'easy',
      mode: 'daily',
      dailyDate: '2026-11-26',
      elapsedMs: 60_000,
      hintsUsed: 0,
      todayDate: '2026-11-27',
    }).stats;

    stats = recordGameWon(stats, {
      difficulty: 'medium',
      mode: 'daily',
      dailyDate: '2026-11-27',
      elapsedMs: 120_000,
      hintsUsed: 1,
      todayDate: '2026-11-27',
    }).stats;

    expect(stats.dailyCompletedDates).toEqual(['2026-11-26', '2026-11-27']);
    expect(stats.dailySolvedKeys['2026-11-27:medium']).toBe(120_000);
    expect(stats.currentDailyStreak).toBe(2);
    expect(stats.bestDailyStreak).toBe(2);
  });
});

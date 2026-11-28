import { describe, expect, it } from 'vitest';
import type { PuzzleRecordLogEntry } from '@hearthside/game-core';
import { createSudokuState } from './reducer';
import { extractSudokuSaveSummary } from './serialization';
import { getStarterPuzzle } from './starterBank';
import {
  computeDailyStreaks,
  createEmptySudokuStats,
  getAverageTimeMs,
  getWinRatePercent,
  recomputeSudokuStatsFromRecords,
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

  it('extracts Sudoku save summaries and deterministically recomputes stats from puzzle records', () => {
    const puzzle = getStarterPuzzle('easy', 0);
    const initial = createSudokuState(puzzle, { mode: 'standard' });
    const givenCount = puzzle.clues.split('').filter((c) => c !== '0').length;
    expect(extractSudokuSaveSummary(initial)).toEqual({
      puzzleId: puzzle.id,
      completed: false,
      elapsedMs: 0,
      filledCells: givenCount,
    });

    const records: PuzzleRecordLogEntry[] = [
      {
        profileId: 'p1',
        gameId: 'sudoku',
        puzzleId: 'e1',
        difficulty: 'easy',
        mode: 'standard',
        status: 'completed',
        elapsedMs: 60_000,
        hintsUsed: 1,
        startedAt: '2026-11-24T10:00:00Z',
        completedAt: '2026-11-24T10:01:00Z',
        updatedAt: '2026-11-24T10:01:00Z',
      },
      // Duplicate older started log for same puzzle e1 should be merged without double-counting
      {
        profileId: 'p1',
        gameId: 'sudoku',
        puzzleId: 'e1',
        difficulty: 'easy',
        mode: 'standard',
        status: 'started',
        elapsedMs: 5_000,
        hintsUsed: 0,
        startedAt: '2026-11-24T09:59:00Z',
        updatedAt: '2026-11-24T09:59:00Z',
      },
      {
        profileId: 'p1',
        gameId: 'sudoku',
        puzzleId: 'e2',
        difficulty: 'easy',
        mode: 'standard',
        status: 'completed',
        elapsedMs: 100_000,
        hintsUsed: 2,
        startedAt: '2026-11-24T11:00:00Z',
        completedAt: '2026-11-24T11:02:00Z',
        updatedAt: '2026-11-24T11:02:00Z',
      },
      {
        profileId: 'p1',
        gameId: 'sudoku',
        puzzleId: 'd1',
        difficulty: 'medium',
        mode: 'daily',
        dailyDate: '2026-11-26',
        status: 'completed',
        elapsedMs: 120_000,
        hintsUsed: 0,
        startedAt: '2026-11-26T08:00:00Z',
        completedAt: '2026-11-26T08:02:00Z',
        updatedAt: '2026-11-26T08:02:00Z',
      },
      {
        profileId: 'p1',
        gameId: 'sudoku',
        puzzleId: 'd2',
        difficulty: 'hard',
        mode: 'daily',
        dailyDate: '2026-11-27',
        status: 'completed',
        elapsedMs: 180_000,
        hintsUsed: 3,
        startedAt: '2026-11-27T08:00:00Z',
        completedAt: '2026-11-27T08:03:00Z',
        updatedAt: '2026-11-27T08:03:00Z',
      },
      // Unfinished started puzzle counts toward gamesStarted but not gamesWon
      {
        profileId: 'p1',
        gameId: 'sudoku',
        puzzleId: 'h-unfinished',
        difficulty: 'hard',
        mode: 'standard',
        status: 'started',
        elapsedMs: 15_000,
        hintsUsed: 0,
        startedAt: '2026-11-27T09:00:00Z',
        updatedAt: '2026-11-27T09:00:00Z',
      },
    ];

    const recomputed = recomputeSudokuStatsFromRecords(records, undefined, '2026-11-27');
    expect(recomputed.gamesStarted).toBe(5);
    expect(recomputed.gamesWon).toBe(4);
    expect(recomputed.totalHintsUsed).toBe(6);
    expect(recomputed.totalPlayMs).toBe(460_000);
    expect(recomputed.byDifficulty.easy).toMatchObject({
      gamesStarted: 2,
      gamesWon: 2,
      completedCount: 2,
      bestTimeMs: 60_000,
      averageTimeMs: 80_000,
    });
    expect(recomputed.dailyCompletedDates).toEqual(['2026-11-26', '2026-11-27']);
    expect(recomputed.currentDailyStreak).toBe(2);
    expect(recomputed.bestDailyStreak).toBe(2);

    // Order-independence and gap streak reset check:
    const reversed = recomputeSudokuStatsFromRecords(
      [...records].reverse(),
      undefined,
      '2026-11-30',
    );
    expect(reversed.gamesWon).toBe(4);
    expect(reversed.currentDailyStreak).toBe(0);
    expect(reversed.bestDailyStreak).toBe(2);
  });
});

import { mergePuzzleRecordLists, type PuzzleRecordLogEntry } from '@hearthside/game-core';
import { getLocalDateString, isSudokuDifficulty, isValidDateKey } from './daily';
import type { SudokuDifficulty, SudokuMode } from './types';

export const SUDOKU_STATS_SCHEMA_VERSION = 1;

export interface DifficultyStats {
  readonly gamesStarted: number;
  readonly gamesWon: number;
  readonly completedCount?: number;
  readonly totalTimeMs: number;
  readonly bestTimeMs: number | null;
  readonly averageTimeMs?: number | null;
}

export interface SudokuProfileStats {
  readonly schemaVersion: number;
  readonly gamesStarted: number;
  readonly gamesWon: number;
  readonly totalPlayMs: number;
  readonly totalHintsUsed: number;
  readonly byDifficulty: {
    readonly easy: DifficultyStats;
    readonly medium: DifficultyStats;
    readonly hard: DifficultyStats;
  };
  readonly dailyCompletedDates: readonly string[];
  /** Maps `${YYYY-MM-DD}:${difficulty}` -> best solve elapsedMs for that daily entry. */
  readonly dailySolvedKeys: Readonly<Record<string, number>>;
  readonly currentDailyStreak: number;
  readonly bestDailyStreak: number;
}

function emptyDifficultyStats(): DifficultyStats {
  return {
    gamesStarted: 0,
    gamesWon: 0,
    totalTimeMs: 0,
    bestTimeMs: null,
  };
}

export function createEmptySudokuStats(): SudokuProfileStats {
  return {
    schemaVersion: SUDOKU_STATS_SCHEMA_VERSION,
    gamesStarted: 0,
    gamesWon: 0,
    totalPlayMs: 0,
    totalHintsUsed: 0,
    byDifficulty: {
      easy: emptyDifficultyStats(),
      medium: emptyDifficultyStats(),
      hard: emptyDifficultyStats(),
    },
    dailyCompletedDates: [],
    dailySolvedKeys: {},
    currentDailyStreak: 0,
    bestDailyStreak: 0,
  };
}

function normalizeDiffStats(raw: unknown): DifficultyStats {
  if (typeof raw !== 'object' || raw === null) {
    return emptyDifficultyStats();
  }
  const r = raw as Record<string, unknown>;
  const gamesStarted =
    typeof r.gamesStarted === 'number' && Number.isFinite(r.gamesStarted) && r.gamesStarted >= 0
      ? Math.floor(r.gamesStarted)
      : 0;
  const gamesWon =
    typeof r.gamesWon === 'number' && Number.isFinite(r.gamesWon) && r.gamesWon >= 0
      ? Math.floor(r.gamesWon)
      : 0;
  const totalTimeMs =
    typeof r.totalTimeMs === 'number' && Number.isFinite(r.totalTimeMs) && r.totalTimeMs >= 0
      ? r.totalTimeMs
      : 0;
  const bestTimeMs =
    typeof r.bestTimeMs === 'number' && Number.isFinite(r.bestTimeMs) && r.bestTimeMs >= 0
      ? r.bestTimeMs
      : null;

  return {
    gamesStarted,
    gamesWon,
    totalTimeMs,
    bestTimeMs,
  };
}

function dateKeyToDayNumber(dateStr: string): number | null {
  if (!isValidDateKey(dateStr)) {
    return null;
  }
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return Math.floor(ms / 86_400_000);
}

export function computeDailyStreaks(
  completedDates: readonly string[],
  todayDate = getLocalDateString(),
): { readonly current: number; readonly best: number } {
  const uniqueDays = Array.from(
    new Set(
      completedDates
        .filter(isValidDateKey)
        .map(dateKeyToDayNumber)
        .filter((d): d is number => d !== null),
    ),
  ).sort((a, b) => a - b);

  if (uniqueDays.length === 0) {
    return { current: 0, best: 0 };
  }

  let best = 0;
  let run = 0;
  let prevDay: number | null = null;

  for (const day of uniqueDays) {
    if (prevDay !== null && day === prevDay + 1) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > best) {
      best = run;
    }
    prevDay = day;
  }

  const todayNum = dateKeyToDayNumber(todayDate);
  if (todayNum === null) {
    return { current: 0, best };
  }

  const daySet = new Set(uniqueDays);
  let anchor: number | null = null;
  if (daySet.has(todayNum)) {
    anchor = todayNum;
  } else if (daySet.has(todayNum - 1)) {
    anchor = todayNum - 1;
  }

  if (anchor === null) {
    return { current: 0, best };
  }

  let current = 0;
  let cursor = anchor;
  while (daySet.has(cursor)) {
    current += 1;
    cursor -= 1;
  }

  return { current, best };
}

export function normalizeSudokuStats(
  raw: unknown,
  todayDate = getLocalDateString(),
): SudokuProfileStats {
  if (typeof raw !== 'object' || raw === null) {
    return createEmptySudokuStats();
  }
  const r = raw as Record<string, unknown>;
  const byDiffRaw =
    typeof r.byDifficulty === 'object' && r.byDifficulty !== null
      ? (r.byDifficulty as Record<string, unknown>)
      : {};

  const dailyCompletedDates = Array.isArray(r.dailyCompletedDates)
    ? Array.from(
        new Set(
          r.dailyCompletedDates.filter(
            (d): d is string => typeof d === 'string' && isValidDateKey(d),
          ),
        ),
      ).sort()
    : [];

  const dailySolvedKeys: Record<string, number> = {};
  if (typeof r.dailySolvedKeys === 'object' && r.dailySolvedKeys !== null) {
    for (const [k, v] of Object.entries(r.dailySolvedKeys as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        dailySolvedKeys[k] = v;
      }
    }
  }

  const streaks = computeDailyStreaks(dailyCompletedDates, todayDate);

  return {
    schemaVersion: SUDOKU_STATS_SCHEMA_VERSION,
    gamesStarted:
      typeof r.gamesStarted === 'number' && Number.isFinite(r.gamesStarted) && r.gamesStarted >= 0
        ? Math.floor(r.gamesStarted)
        : 0,
    gamesWon:
      typeof r.gamesWon === 'number' && Number.isFinite(r.gamesWon) && r.gamesWon >= 0
        ? Math.floor(r.gamesWon)
        : 0,
    totalPlayMs:
      typeof r.totalPlayMs === 'number' && Number.isFinite(r.totalPlayMs) && r.totalPlayMs >= 0
        ? r.totalPlayMs
        : 0,
    totalHintsUsed:
      typeof r.totalHintsUsed === 'number' &&
      Number.isFinite(r.totalHintsUsed) &&
      r.totalHintsUsed >= 0
        ? Math.floor(r.totalHintsUsed)
        : 0,
    byDifficulty: {
      easy: normalizeDiffStats(byDiffRaw.easy),
      medium: normalizeDiffStats(byDiffRaw.medium),
      hard: normalizeDiffStats(byDiffRaw.hard),
    },
    dailyCompletedDates,
    dailySolvedKeys,
    currentDailyStreak: streaks.current,
    bestDailyStreak: Math.max(
      streaks.best,
      typeof r.bestDailyStreak === 'number' && Number.isFinite(r.bestDailyStreak)
        ? Math.floor(r.bestDailyStreak)
        : 0,
    ),
  };
}

export function recordGameStarted(
  stats: SudokuProfileStats,
  difficulty: SudokuDifficulty,
): SudokuProfileStats {
  const prevDiff = stats.byDifficulty[difficulty];
  return {
    ...stats,
    gamesStarted: stats.gamesStarted + 1,
    byDifficulty: {
      ...stats.byDifficulty,
      [difficulty]: {
        ...prevDiff,
        gamesStarted: prevDiff.gamesStarted + 1,
      },
    },
  };
}

export interface RecordGameWonInput {
  readonly difficulty: SudokuDifficulty;
  readonly mode: SudokuMode;
  readonly dailyDate?: string;
  readonly elapsedMs: number;
  readonly hintsUsed: number;
  readonly todayDate?: string;
}

export function recordGameWon(
  stats: SudokuProfileStats,
  input: RecordGameWonInput,
): { readonly stats: SudokuProfileStats; readonly isNewPersonalBest: boolean } {
  const safeElapsed = Math.max(0, Math.floor(input.elapsedMs));
  const safeHints = Math.max(0, Math.floor(input.hintsUsed));
  const prevDiff = stats.byDifficulty[input.difficulty];
  const isNewPersonalBest = prevDiff.bestTimeMs === null || safeElapsed < prevDiff.bestTimeMs;
  const nextBestTimeMs = isNewPersonalBest ? safeElapsed : prevDiff.bestTimeMs;

  let nextDates = stats.dailyCompletedDates;
  let nextSolvedKeys = stats.dailySolvedKeys;
  if (input.mode === 'daily' && input.dailyDate && isValidDateKey(input.dailyDate)) {
    if (!nextDates.includes(input.dailyDate)) {
      nextDates = [...nextDates, input.dailyDate].sort();
    }
    const key = `${input.dailyDate}:${input.difficulty}`;
    const prevDailyBest = nextSolvedKeys[key];
    nextSolvedKeys = {
      ...nextSolvedKeys,
      [key]: prevDailyBest !== undefined ? Math.min(prevDailyBest, safeElapsed) : safeElapsed,
    };
  }

  const streaks = computeDailyStreaks(nextDates, input.todayDate ?? getLocalDateString());

  return {
    isNewPersonalBest,
    stats: {
      ...stats,
      gamesWon: stats.gamesWon + 1,
      totalPlayMs: stats.totalPlayMs + safeElapsed,
      totalHintsUsed: stats.totalHintsUsed + safeHints,
      byDifficulty: {
        ...stats.byDifficulty,
        [input.difficulty]: {
          gamesStarted: Math.max(prevDiff.gamesStarted, prevDiff.gamesWon + 1),
          gamesWon: prevDiff.gamesWon + 1,
          totalTimeMs: prevDiff.totalTimeMs + safeElapsed,
          bestTimeMs: nextBestTimeMs,
        },
      },
      dailyCompletedDates: nextDates,
      dailySolvedKeys: nextSolvedKeys,
      currentDailyStreak: streaks.current,
      bestDailyStreak: Math.max(stats.bestDailyStreak, streaks.best),
    },
  };
}

export function getWinRatePercent(stats: SudokuProfileStats): number {
  if (stats.gamesStarted <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((stats.gamesWon / stats.gamesStarted) * 100));
}

export function getAverageTimeMs(diffStats: DifficultyStats): number | null {
  if (diffStats.gamesWon <= 0) {
    return null;
  }
  return Math.round(diffStats.totalTimeMs / diffStats.gamesWon);
}

/**
 * Losslessly recomputes aggregate Sudoku profile stats from deduplicated immutable puzzle records
 * (D31), optionally blending in a v1.0 legacy baseline when older offline solves predate logs.
 */
export function recomputeSudokuStatsFromRecords(
  records: readonly PuzzleRecordLogEntry[],
  legacyBaseline?: SudokuProfileStats,
  todayDate = getLocalDateString(),
): SudokuProfileStats {
  const deduped = mergePuzzleRecordLists(records, []).filter(
    (entry): entry is PuzzleRecordLogEntry & { readonly difficulty: SudokuDifficulty } =>
      entry.gameId === 'sudoku' && isSudokuDifficulty(entry.difficulty),
  );

  const counts: Record<
    SudokuDifficulty,
    { started: number; won: number; totalTimeMs: number; bestTimeMs: number | null }
  > = {
    easy: { started: 0, won: 0, totalTimeMs: 0, bestTimeMs: null },
    medium: { started: 0, won: 0, totalTimeMs: 0, bestTimeMs: null },
    hard: { started: 0, won: 0, totalTimeMs: 0, bestTimeMs: null },
  };

  let totalPlayMs = 0;
  let totalHintsUsed = 0;
  const dailyDateSet = new Set<string>(legacyBaseline?.dailyCompletedDates ?? []);
  const dailySolvedKeys: Record<string, number> = {
    ...(legacyBaseline?.dailySolvedKeys ?? {}),
  };

  for (const entry of deduped) {
    const bucket = counts[entry.difficulty];
    bucket.started += 1;

    if (entry.status === 'completed') {
      const safeElapsed = Math.max(0, Math.floor(entry.elapsedMs));
      const safeHints = Math.max(0, Math.floor(entry.hintsUsed));
      bucket.won += 1;
      bucket.totalTimeMs += safeElapsed;
      bucket.bestTimeMs =
        bucket.bestTimeMs === null ? safeElapsed : Math.min(bucket.bestTimeMs, safeElapsed);
      totalPlayMs += safeElapsed;
      totalHintsUsed += safeHints;

      if (entry.mode === 'daily' && entry.dailyDate && isValidDateKey(entry.dailyDate)) {
        dailyDateSet.add(entry.dailyDate);
        const dailyKey = `${entry.dailyDate}:${entry.difficulty}`;
        const prevBest = dailySolvedKeys[dailyKey];
        dailySolvedKeys[dailyKey] =
          prevBest !== undefined ? Math.min(prevBest, safeElapsed) : safeElapsed;
      }
    }
  }

  const finalizeDiff = (diff: SudokuDifficulty): DifficultyStats => {
    const recBucket = counts[diff];
    const baseBucket = legacyBaseline?.byDifficulty[diff];
    const useLegacyWins = baseBucket !== undefined && baseBucket.gamesWon > recBucket.won;

    const gamesWon = useLegacyWins ? baseBucket.gamesWon : recBucket.won;
    const totalTimeMs = useLegacyWins ? baseBucket.totalTimeMs : recBucket.totalTimeMs;
    const bestTimeMs = useLegacyWins
      ? baseBucket.bestTimeMs === null
        ? recBucket.bestTimeMs
        : recBucket.bestTimeMs === null
          ? baseBucket.bestTimeMs
          : Math.min(baseBucket.bestTimeMs, recBucket.bestTimeMs)
      : recBucket.bestTimeMs;
    const gamesStarted = Math.max(
      recBucket.started,
      gamesWon,
      baseBucket?.gamesStarted ?? 0,
    );

    return {
      gamesStarted,
      gamesWon,
      completedCount: gamesWon,
      totalTimeMs,
      bestTimeMs,
      averageTimeMs: gamesWon > 0 ? Math.round(totalTimeMs / gamesWon) : null,
    };
  };

  const easy = finalizeDiff('easy');
  const medium = finalizeDiff('medium');
  const hard = finalizeDiff('hard');

  const dailyCompletedDates = Array.from(dailyDateSet).filter(isValidDateKey).sort();
  const streaks = computeDailyStreaks(dailyCompletedDates, todayDate);

  const gamesStarted = Math.max(
    easy.gamesStarted + medium.gamesStarted + hard.gamesStarted,
    legacyBaseline?.gamesStarted ?? 0,
  );
  const gamesWon = easy.gamesWon + medium.gamesWon + hard.gamesWon;

  return {
    schemaVersion: SUDOKU_STATS_SCHEMA_VERSION,
    gamesStarted,
    gamesWon,
    totalPlayMs: Math.max(totalPlayMs, easy.totalTimeMs + medium.totalTimeMs + hard.totalTimeMs),
    totalHintsUsed: Math.max(totalHintsUsed, legacyBaseline?.totalHintsUsed ?? 0),
    byDifficulty: { easy, medium, hard },
    dailyCompletedDates,
    dailySolvedKeys,
    currentDailyStreak: streaks.current,
    bestDailyStreak: Math.max(streaks.best, legacyBaseline?.bestDailyStreak ?? 0),
  };
}

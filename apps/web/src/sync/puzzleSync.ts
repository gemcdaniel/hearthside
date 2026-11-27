import type { PuzzleSyncService } from '@hearthside/game-core';
import {
  getDailyPuzzle,
  getDailyPuzzlesAll,
  getPuzzleBank,
  hasSessionHint,
  isNavigatorOnline,
} from '../api/client';
import type { RemotePuzzleRecord } from '../api/types';
import {
  getServerSyncMeta,
  listCompletedPuzzles,
  listServerBankPuzzles,
  putCachedPuzzle,
  putServerBankPuzzles,
} from '../storage/hearthsideDb';

type Difficulty = 'easy' | 'medium' | 'hard';
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];
const LOW_WATER_BANK_COUNT = 15;
const TOP_UP_BATCH_LIMIT = 25;

const inFlightTopUps = new Map<Difficulty, Promise<void>>();

function isDifficulty(value: string): value is Difficulty {
  return value === 'easy' || value === 'medium' || value === 'hard';
}

function getLocalYYYYMMDD(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function canSyncOnline(isSignedIn: boolean): boolean {
  return isSignedIn && hasSessionHint() && isNavigatorOnline();
}

async function runBankTopUp(
  difficulty: Difficulty,
  excludeIds?: ReadonlySet<string>,
): Promise<void> {
  const existing = await listServerBankPuzzles<RemotePuzzleRecord>(difficulty);
  const unplayedCount = excludeIds
    ? existing.filter((p) => !excludeIds.has(p.id)).length
    : existing.length;
  if (unplayedCount >= LOW_WATER_BANK_COUNT) {
    return;
  }

  const meta = await getServerSyncMeta(difficulty);
  const afterSeq = meta?.lastSeq ?? 0;

  const res = await getPuzzleBank(difficulty, afterSeq, TOP_UP_BATCH_LIMIT);
  if (res.status !== 'ok') {
    return;
  }
  const items = res.data.puzzles.map((p, idx) => ({
    ...p,
    seq: p.seq ?? afterSeq + idx + 1,
  }));
  await putServerBankPuzzles(difficulty, items, res.data.nextSeq);
}

export function triggerBankTopUp(
  difficulty: Difficulty,
  excludeIds?: ReadonlySet<string>,
): Promise<void> {
  const existing = inFlightTopUps.get(difficulty);
  if (existing) {
    return existing;
  }
  const op = runBankTopUp(difficulty, excludeIds)
    .catch(() => {})
    .finally(() => {
      if (inFlightTopUps.get(difficulty) === op) {
        inFlightTopUps.delete(difficulty);
      }
    });
  inFlightTopUps.set(difficulty, op);
  return op;
}

export async function prefetchDailyAndBank(activeProfileId: string): Promise<void> {
  if (!hasSessionHint() || !isNavigatorOnline()) {
    return;
  }

  try {
    const today = getLocalYYYYMMDD();
    const dailyAll = await getDailyPuzzlesAll(today);
    if (dailyAll.status === 'ok') {
      const entries: readonly (readonly [Difficulty, RemotePuzzleRecord])[] = [
        ['easy', dailyAll.data.puzzles.easy],
        ['medium', dailyAll.data.puzzles.medium],
        ['hard', dailyAll.data.puzzles.hard],
      ];
      await Promise.all(
        entries.map(([diff, puzzle]) =>
          putCachedPuzzle('sudoku', `daily:${today}:${diff}:${puzzle.engineVersion}`, puzzle).catch(
            () => {},
          ),
        ),
      );
    }

    const completed = await listCompletedPuzzles(activeProfileId, 'sudoku').catch(() => []);
    const excludeIds = new Set(completed.map((c) => c.puzzleId));
    await Promise.all(DIFFICULTIES.map((diff) => triggerBankTopUp(diff, excludeIds)));
  } catch {
    // Background prefetch never disrupts local offline gameplay.
  }
}

export function createShellPuzzleSync(isSignedIn: boolean): PuzzleSyncService {
  return {
    async fetchDailyPuzzle<TPuzzle = unknown>(
      dateKey: string,
      difficulty: string,
    ): Promise<TPuzzle | null> {
      if (!canSyncOnline(isSignedIn) || !isDifficulty(difficulty)) {
        return null;
      }
      const res = await getDailyPuzzle(dateKey, difficulty);
      if (res.status !== 'ok') {
        return null;
      }
      return res.data.puzzle as unknown as TPuzzle;
    },

    async pickCachedBankPuzzle<TPuzzle = unknown>(
      difficulty: string,
      excludeIds: ReadonlySet<string>,
    ): Promise<TPuzzle | null> {
      if (!isDifficulty(difficulty)) {
        return null;
      }
      try {
        const cached = await listServerBankPuzzles<RemotePuzzleRecord>(difficulty);
        const remaining = cached.filter((p) => !excludeIds.has(p.id));
        if (canSyncOnline(isSignedIn) && remaining.length < LOW_WATER_BANK_COUNT) {
          void triggerBankTopUp(difficulty, excludeIds);
        }
        return (remaining[0] as unknown as TPuzzle | undefined) ?? null;
      } catch {
        return null;
      }
    },

    async requestBankTopUp(difficulty: string, excludeIds: ReadonlySet<string>): Promise<void> {
      if (!canSyncOnline(isSignedIn) || !isDifficulty(difficulty)) {
        return;
      }
      await triggerBankTopUp(difficulty, excludeIds);
    },
  };
}

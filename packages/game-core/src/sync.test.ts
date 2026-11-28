import { describe, expect, it } from 'vitest';
import {
  createDefaultProfileSettings,
  extractSyncedPreferences,
  mergePreferencesLWW,
  mergePuzzleRecord,
  mergePuzzleRecordLists,
  type PuzzleRecordLogEntry,
} from './index';

function makeRecord(overrides: Partial<PuzzleRecordLogEntry> = {}): PuzzleRecordLogEntry {
  return {
    profileId: 'prof-1',
    gameId: 'sudoku',
    puzzleId: 'puz-1',
    difficulty: 'easy',
    mode: 'standard',
    status: 'started',
    elapsedMs: 10_000,
    hintsUsed: 1,
    startedAt: '2026-11-27T12:00:00.000Z',
    updatedAt: '2026-11-27T12:01:00.000Z',
    ...overrides,
  };
}

describe('packages/game-core pure sync merge helpers', () => {
  it('merges puzzle records monotonically without ever downgrading completed to started', () => {
    const startedLater = makeRecord({
      status: 'started',
      startedAt: '2026-11-27T12:02:00.000Z',
      elapsedMs: 50_000,
      hintsUsed: 4,
      updatedAt: '2026-11-27T12:05:00.000Z',
    });
    const completed = makeRecord({
      status: 'completed',
      startedAt: '2026-11-27T12:00:00.000Z',
      completedAt: '2026-11-27T12:03:00.000Z',
      elapsedMs: 40_000,
      hintsUsed: 1,
      updatedAt: '2026-11-27T12:03:00.000Z',
    });

    // Upgrade started -> completed
    const upgraded = mergePuzzleRecord(startedLater, completed);
    expect(upgraded.status).toBe('completed');
    expect(upgraded.elapsedMs).toBe(40_000);
    expect(upgraded.startedAt).toBe('2026-11-27T12:00:00.000Z');

    // Completed cannot be downgraded by later started record, even keeping earliest startedAt
    const startedEarlier = makeRecord({
      status: 'started',
      startedAt: '2026-11-27T11:59:00.000Z',
      elapsedMs: 99_000,
    });
    const keptCompleted = mergePuzzleRecord(completed, startedEarlier);
    expect(keptCompleted.status).toBe('completed');
    expect(keptCompleted.startedAt).toBe('2026-11-27T11:59:00.000Z');
    expect(keptCompleted.elapsedMs).toBe(40_000);
  });

  it('breaks ties between two completed records by earliest completedAt, then lower elapsedMs, then lower hintsUsed', () => {
    const earlierFinish = makeRecord({
      status: 'completed',
      completedAt: '2026-11-27T12:02:00.000Z',
      elapsedMs: 80_000,
      hintsUsed: 3,
    });
    const laterFinish = makeRecord({
      status: 'completed',
      completedAt: '2026-11-27T12:04:00.000Z',
      elapsedMs: 20_000,
      hintsUsed: 0,
    });
    expect(mergePuzzleRecord(laterFinish, earlierFinish).completedAt).toBe(
      '2026-11-27T12:02:00.000Z',
    );

    const sameTimeSlower = makeRecord({
      status: 'completed',
      completedAt: '2026-11-27T12:02:00.000Z',
      elapsedMs: 80_000,
      hintsUsed: 0,
    });
    const sameTimeFaster = makeRecord({
      status: 'completed',
      completedAt: '2026-11-27T12:02:00.000Z',
      elapsedMs: 65_000,
      hintsUsed: 2,
    });
    expect(mergePuzzleRecord(sameTimeSlower, sameTimeFaster).elapsedMs).toBe(65_000);

    const fewerHints = makeRecord({
      status: 'completed',
      completedAt: '2026-11-27T12:02:00.000Z',
      elapsedMs: 65_000,
      hintsUsed: 1,
    });
    expect(mergePuzzleRecord(sameTimeFaster, fewerHints).hintsUsed).toBe(1);
  });

  it('produces idempotent unions when merging puzzle record lists', () => {
    const a = [
      makeRecord({ puzzleId: 'p2', status: 'started', startedAt: '2026-11-27T12:10:00.000Z' }),
      makeRecord({
        puzzleId: 'p1',
        status: 'completed',
        startedAt: '2026-11-27T12:00:00.000Z',
        completedAt: '2026-11-27T12:01:00.000Z',
        elapsedMs: 30_000,
        hintsUsed: 0,
      }),
    ];
    const b = [
      makeRecord({
        puzzleId: 'p2',
        mode: 'daily',
        dailyDate: '2026-11-27',
        status: 'completed',
        startedAt: '2026-11-27T12:09:00.000Z',
        completedAt: '2026-11-27T12:12:00.000Z',
        elapsedMs: 45_000,
        hintsUsed: 1,
      }),
    ];

    const first = mergePuzzleRecordLists(a, b);
    const repeat = mergePuzzleRecordLists(first, b);
    expect(first).toEqual(repeat);
    expect(first.map((r) => `${r.puzzleId}:${r.status}`)).toEqual([
      'p1:completed',
      'p2:completed',
    ]);
    expect(first[1]?.dailyDate).toBe('2026-11-27');
  });

  it('applies synced theme and gameplay rules via LWW while keeping audio settings device-local', () => {
    const localSettings = {
      ...createDefaultProfileSettings('light'),
      theme: 'clean-minimal' as const,
      sfxEnabled: false,
      sfxVolume: 0.25,
      musicEnabled: true,
      musicVolume: 0.9,
      sudoku: { flagDuplicateConflicts: true, flagWrongValues: false },
    };

    const syncedPayload = extractSyncedPreferences(localSettings, '2026-11-27T12:00:00.000Z');
    expect('sfxEnabled' in (syncedPayload as unknown as Record<string, unknown>)).toBe(false);
    expect('sfxEnabled' in (syncedPayload.gameplay as Record<string, unknown>)).toBe(false);

    // Older remote update is ignored cleanly.
    const olderResult = mergePreferencesLWW(localSettings, '2026-11-27T12:05:00.000Z', {
      theme: 'warm-hearthside',
      mode: 'dark',
      gameplay: { sudoku: { flagDuplicateConflicts: false, flagWrongValues: true } },
      updatedAt: '2026-11-27T12:04:00.000Z',
    });
    expect(olderResult.appliedRemote).toBe(false);
    expect(olderResult.settings).toEqual(localSettings);

    // Newer remote update updates theme, mode, and sudoku rules while keeping audio local.
    const newerResult = mergePreferencesLWW(localSettings, '2026-11-27T12:05:00.000Z', {
      theme: 'warm-hearthside',
      mode: 'dark',
      gameplay: { sudoku: { flagDuplicateConflicts: false, flagWrongValues: true } },
      updatedAt: '2026-11-27T12:06:00.000Z',
    });
    expect(newerResult.appliedRemote).toBe(true);
    expect(newerResult.settings).toEqual({
      theme: 'warm-hearthside',
      mode: 'dark',
      sfxEnabled: false,
      sfxVolume: 0.25,
      musicEnabled: true,
      musicVolume: 0.9,
      sudoku: { flagDuplicateConflicts: false, flagWrongValues: true },
    });
  });
});

import 'fake-indexeddb/auto';
import { createDefaultProfileSettings } from '@hearthside/game-core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE_NAME,
  createGameStorageService,
  createProfile,
  deleteProfile,
  ensureInitialized,
  exportAllData,
  getProfileSettings,
  importAllData,
  listProfiles,
  resetHearthsideDbForTests,
  saveProfileSettings,
  updateProfile,
} from './hearthsideDb';

describe('hearthsideDb storage layer', () => {
  afterEach(async () => {
    await resetHearthsideDbForTests();
  });

  it('seeds Player 1 on first launch with D21 defaults', async () => {
    const init = await ensureInitialized();
    expect(init.profiles).toHaveLength(1);
    expect(init.activeProfile.name).toBe(DEFAULT_PROFILE_NAME);
    expect(init.settings.sudoku).toEqual({
      flagDuplicateConflicts: true,
      flagWrongValues: false,
    });
  });

  it('isolates settings, saves, stats, and completed puzzles per profile and cascades delete', async () => {
    const init = await ensureInitialized();
    const p1 = init.activeProfile;
    const p2 = await createProfile({
      name: 'Sam',
      avatarId: 'fox',
      accentColor: 'terracotta',
    });

    const p2Renamed = await updateProfile(p2.id, { name: 'Samantha' });
    expect(p2Renamed.name).toBe('Samantha');

    await saveProfileSettings(p2.id, {
      ...createDefaultProfileSettings('dark'),
      theme: 'warm-hearthside',
      sfxEnabled: false,
      sudoku: { flagDuplicateConflicts: true, flagWrongValues: true },
    });

    const p1Storage = createGameStorageService(p1.id, 'sudoku');
    const p2Storage = createGameStorageService(p2.id, 'sudoku');

    await p1Storage.saveGame({
      schemaVersion: 1,
      profileId: p1.id,
      gameId: 'sudoku',
      slot: 'easy',
      updatedAt: '2026-11-27T12:00:00.000Z',
      payload: { clues: 'p1-easy' },
    });
    await p2Storage.saveGame({
      schemaVersion: 1,
      profileId: p2.id,
      gameId: 'sudoku',
      slot: 'easy',
      updatedAt: '2026-11-27T12:01:00.000Z',
      payload: { clues: 'p2-easy' },
    });
    await p2Storage.saveStats({
      schemaVersion: 1,
      profileId: p2.id,
      gameId: 'sudoku',
      updatedAt: '2026-11-27T12:02:00.000Z',
      stats: { gamesWon: 3 },
    });
    await p2Storage.recordCompletedPuzzle({
      profileId: p2.id,
      gameId: 'sudoku',
      puzzleId: 'hs-easy-1',
      difficulty: 'easy',
      completedAt: '2026-11-27T12:03:00.000Z',
      elapsedMs: 42000,
      hintsUsed: 0,
    });

    expect((await p1Storage.loadSave<{ clues: string }>('easy'))?.payload.clues).toBe('p1-easy');
    expect((await p2Storage.loadSave<{ clues: string }>('easy'))?.payload.clues).toBe('p2-easy');
    expect((await p1Storage.loadStats()) ?? null).toBeNull();
    expect(await p2Storage.listCompletedPuzzles()).toHaveLength(1);

    await deleteProfile(p2.id);
    expect(await listProfiles()).toHaveLength(1);
    expect((await p2Storage.loadSave('easy')) ?? null).toBeNull();
    expect(await p2Storage.listCompletedPuzzles()).toHaveLength(0);

    // Deleting the last profile must fail cleanly.
    await expect(deleteProfile(p1.id)).rejects.toThrow(/last remaining/);
  });

  it('exports and imports all data losslessly while rejecting invalid backups safely', async () => {
    const init = await ensureInitialized();
    const p1 = init.activeProfile;
    const p2 = await createProfile({ name: 'Jamie', avatarId: 'owl', accentColor: 'forest' });

    const p2Settings = {
      ...createDefaultProfileSettings('dark'),
      theme: 'warm-hearthside' as const,
      sudoku: { flagDuplicateConflicts: false, flagWrongValues: true },
    };
    await saveProfileSettings(p2.id, p2Settings);

    const p2Storage = createGameStorageService(p2.id, 'sudoku');
    await p2Storage.saveGame({
      schemaVersion: 1,
      profileId: p2.id,
      gameId: 'sudoku',
      slot: 'daily',
      updatedAt: '2026-11-27T12:10:00.000Z',
      payload: { seed: 20261127 },
    });

    const exportedJson = await exportAllData();

    // Mutate local state, then ensure malformed imports do NOT overwrite existing data.
    await updateProfile(p1.id, { name: 'Player One Edited' });
    await expect(importAllData('{not json')).rejects.toThrow(/valid JSON/);
    await expect(
      importAllData(
        JSON.stringify({ app: 'OtherApp', schemaVersion: 1, exportedAt: 'x', data: {} }),
      ),
    ).rejects.toThrow(/Unsupported export app/);
    await expect(
      importAllData(
        JSON.stringify({
          app: 'Hearthside',
          schemaVersion: 1,
          exportedAt: '2026-11-27T12:00:00Z',
          data: { profiles: [], settings: [], saves: [], stats: [], completedPuzzles: [] },
        }),
      ),
    ).rejects.toThrow(/at least one profile/);

    const afterInvalidImport = await listProfiles();
    expect(afterInvalidImport.find((p) => p.id === p1.id)?.name).toBe('Player One Edited');

    // Now restore the valid exported backup.
    const imported = await importAllData(exportedJson);
    expect(imported.data.profiles).toHaveLength(2);
    expect((await listProfiles()).find((p) => p.id === p1.id)?.name).toBe(DEFAULT_PROFILE_NAME);
    expect(await getProfileSettings(p2.id)).toEqual(p2Settings);
    expect((await p2Storage.loadSave<{ seed: number }>('daily'))?.payload.seed).toBe(20261127);
  });

  it('caches and shares deterministic Daily puzzles across profiles in IndexedDB v2 store', async () => {
    const init = await ensureInitialized();
    const p1 = init.activeProfile;
    const p2 = await createProfile({ name: 'Sam', avatarId: 'fox', accentColor: 'terracotta' });

    const p1Storage = createGameStorageService(p1.id, 'sudoku');
    const p2Storage = createGameStorageService(p2.id, 'sudoku');

    const cacheKey = 'daily:2026-11-27:easy:0.1.0-dev';
    expect(await p1Storage.loadCachedPuzzle(cacheKey)).toBeNull();

    const record = { id: 'daily-1', seed: 123456, clues: '530...', solution: '534...' };
    await p1Storage.saveCachedPuzzle(cacheKey, record);

    expect(await p1Storage.loadCachedPuzzle(cacheKey)).toEqual(record);
    expect(await p2Storage.loadCachedPuzzle(cacheKey)).toEqual(record);
  });
});

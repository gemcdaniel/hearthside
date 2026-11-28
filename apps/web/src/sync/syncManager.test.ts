import 'fake-indexeddb/auto';
import {
  createDefaultProfileSettings,
  type CloudSaveRecord,
  type ProfileSettings,
  type SyncStatusState,
} from '@hearthside/game-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PushRecordsBatchItem, PushSaveSlotResult, SyncApiClient } from '../api/types';
import {
  createGameStorageService,
  createProfile,
  deleteSave,
  ensureInitialized,
  getProfileSettings,
  getProfileSyncState,
  getRawSave,
  linkLocalProfileToHousehold,
  listPuzzleRecords,
  listSyncConflicts,
  resetHearthsideDbForTests,
  saveProfileSettings,
} from '../storage/hearthsideDb';
import { SyncManager } from './syncManager';

function makeCloudSave(overrides: Partial<CloudSaveRecord> = {}): CloudSaveRecord {
  return {
    profileId: 'remote-p1',
    gameId: 'sudoku',
    slot: 'easy',
    schemaVersion: 1,
    revision: 1,
    puzzleId: 'puz-1',
    completed: false,
    deleted: false,
    elapsedMs: 12_000,
    filledCells: 20,
    payload: '{"mock":true}',
    clientUpdatedAt: '2026-11-27T16:00:00.000Z',
    updatedAt: '2026-11-27T16:00:01.000Z',
    ...overrides,
  };
}

function createMockApi(overrides: Partial<SyncApiClient> = {}): SyncApiClient {
  return {
    pullProfileSync: vi.fn().mockResolvedValue({
      status: 'ok',
      data: {
        profileId: 'remote-p1',
        saves: [],
        records: [],
        preferences: null,
        serverTime: '2026-11-27T16:00:05.000Z',
      },
    }),
    pushSaveSlot: vi.fn().mockImplementation(async (_rid, gameId, slot, body) => ({
      ok: true,
      resolution: 'applied',
      save: makeCloudSave({
        gameId,
        slot,
        revision: body.baseRevision + 1,
        puzzleId: body.puzzleId,
        completed: body.completed,
        deleted: body.deleted,
        elapsedMs: body.elapsedMs,
        filledCells: body.filledCells,
        payload: body.payload,
        clientUpdatedAt: body.clientUpdatedAt,
      }),
    })),
    pushRecordsBatch: vi
      .fn()
      .mockImplementation(async (_rid: string, records: readonly PushRecordsBatchItem[]) => ({
        status: 'ok',
        data: {
          appliedCount: records.length,
          records: records.map((r) => ({
            ...r,
            profileId: 'remote-p1',
            updatedAt: '2026-11-27T16:00:02.000Z',
          })),
        },
      })),
    pushPreferences: vi.fn().mockImplementation(async (_rid, prefs) => ({
      status: 'ok',
      data: {
        applied: true,
        preferences: {
          ...prefs,
          profileId: 'remote-p1',
          serverUpdatedAt: '2026-11-27T16:00:02.000Z',
        },
      },
    })),
    ...overrides,
  };
}

describe('SyncManager background orchestration and conflict flows', () => {
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await resetHearthsideDbForTests();
  });

  it('acts as a complete no-op for unlinked profiles or signed-out sessions with zero errors', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const init = await ensureInitialized();
    const api = createMockApi();
    const manager = new SyncManager({ api });

    manager.setActiveProfileId(init.activeProfile.id);
    await manager.syncNow(init.activeProfile.id);
    await manager.notifyGameSaved(init.activeProfile.id, 'sudoku', 'easy', 'pause');

    // Signed in, but profile is still local-only (no remoteProfileId)
    manager.setSessionActive(true);
    await manager.syncNow(init.activeProfile.id);

    expect(api.pullProfileSync).not.toHaveBeenCalled();
    expect(api.pushSaveSlot).not.toHaveBeenCalled();
    expect(api.pushRecordsBatch).not.toHaveBeenCalled();
    expect(consoleErr).not.toHaveBeenCalled();
  });

  it('pushes fast-forward revisions, tombstones deleted saves, and handles auto_completed_local/remote', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const init = await ensureInitialized();
    const localId = init.activeProfile.id;
    const storage = createGameStorageService(localId, 'sudoku');

    await linkLocalProfileToHousehold(localId, {
      id: 'remote-p1',
      householdId: 'hh-1',
      isChild: false,
    });

    await storage.saveGame({
      schemaVersion: 1,
      profileId: localId,
      gameId: 'sudoku',
      slot: 'easy',
      updatedAt: '2026-11-27T16:00:00.000Z',
      summary: { puzzleId: 'puz-1', completed: false, elapsedMs: 1000, filledCells: 10 },
      payload: '{"move":1}',
    });

    const onRemoteSavesApplied = vi.fn();
    const api = createMockApi();
    const manager = new SyncManager({
      api,
      onRemoteSavesApplied,
      now: () => new Date('2026-11-27T16:00:05.000Z'),
    });
    manager.setSessionActive(true);
    manager.setActiveProfileId(localId);

    // 1. Initial upload: baseRevision 0 -> server revision 1, clears dirty
    await manager.syncNow(localId);
    const saved = await storage.loadSave('easy');
    expect(saved).toMatchObject({ baseRevision: 1, dirty: false });

    // 2. Delete save -> creates tombstone -> syncs deleted=true -> purges local tombstone
    await deleteSave(localId, 'sudoku', 'easy');
    expect(await getRawSave(localId, 'sudoku', 'easy')).toMatchObject({
      deleted: true,
      dirty: true,
      baseRevision: 1,
    });
    await manager.syncNow(localId);
    expect(await getRawSave(localId, 'sudoku', 'easy')).toBeNull();

    // 3. auto_completed_remote updates local save cleanly with server completed snapshot
    await storage.saveGame({
      schemaVersion: 1,
      profileId: localId,
      gameId: 'sudoku',
      slot: 'medium',
      updatedAt: '2026-11-27T16:01:00.000Z',
      summary: { puzzleId: 'puz-med', completed: false, elapsedMs: 5000, filledCells: 30 },
      payload: '{"local":true}',
    });
    (api.pushSaveSlot as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      resolution: 'auto_completed_remote',
      save: makeCloudSave({
        slot: 'medium',
        revision: 4,
        puzzleId: 'puz-med',
        completed: true,
        elapsedMs: 42_000,
        filledCells: 81,
        payload: '{"remoteCompleted":true}',
      }),
    } satisfies PushSaveSlotResult);

    await manager.syncNow(localId);
    const medium = await storage.loadSave<string>('medium');
    expect(medium).toMatchObject({
      baseRevision: 4,
      dirty: false,
      payload: '{"remoteCompleted":true}',
      summary: { completed: true, filledCells: 81 },
    });
    expect(onRemoteSavesApplied).toHaveBeenCalledWith(localId, 'sudoku');
  });

  it('captures 409 conflicts safely and resolves via Keep Local (force) or Keep Cloud', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const p2 = await createProfile({
      name: 'Alex',
      avatarId: 'owl',
      accentColor: 'plum',
      remoteProfileId: 'remote-alex',
      householdId: 'hh-1',
      isChild: false,
    });
    const storage = createGameStorageService(p2.id, 'sudoku');

    const localEnv = {
      schemaVersion: 1,
      profileId: p2.id,
      gameId: 'sudoku',
      slot: 'hard',
      updatedAt: '2026-11-27T16:00:00.000Z',
      summary: { puzzleId: 'puz-local', completed: false, elapsedMs: 12_000, filledCells: 25 },
      payload: '{"side":"local"}',
    };
    await storage.saveGame(localEnv);

    const serverCopy = makeCloudSave({
      profileId: 'remote-alex',
      slot: 'hard',
      revision: 3,
      puzzleId: 'puz-remote',
      elapsedMs: 28_000,
      filledCells: 44,
      payload: '{"side":"cloud"}',
    });

    const pushSaveMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        kind: 'conflict',
        serverSave: serverCopy,
      } satisfies PushSaveSlotResult)
      .mockResolvedValueOnce({
        ok: true,
        resolution: 'applied',
        save: makeCloudSave({
          profileId: 'remote-alex',
          slot: 'hard',
          revision: 4,
          puzzleId: 'puz-local',
          payload: '{"side":"local"}',
        }),
      } satisfies PushSaveSlotResult);

    const api = createMockApi({ pushSaveSlot: pushSaveMock });
    const statuses: SyncStatusState[] = [];
    const manager = new SyncManager({ api });
    manager.subscribe((s) => statuses.push(s));
    manager.setSessionActive(true);
    manager.setActiveProfileId(p2.id);

    await manager.syncNow(p2.id);

    // Local save remains untouched while conflict is persisted
    expect((await storage.loadSave('hard'))?.payload).toBe('{"side":"local"}');
    expect(await listSyncConflicts(p2.id)).toHaveLength(1);
    expect(statuses[statuses.length - 1]?.status).toBe('conflict');

    // Keep Local sends force: true and clears conflict
    await manager.resolveConflictKeepLocal(p2.id, 'sudoku', 'hard');
    expect(pushSaveMock.mock.calls[1]?.[3]).toMatchObject({
      force: true,
      baseRevision: 3,
      puzzleId: 'puz-local',
    });
    expect(await listSyncConflicts(p2.id)).toHaveLength(0);
    expect(await storage.loadSave('hard')).toMatchObject({
      baseRevision: 4,
      dirty: false,
      payload: '{"side":"local"}',
    });

    // Trigger another 409 conflict and resolve via Keep Cloud
    await storage.saveGame({
      ...localEnv,
      updatedAt: '2026-11-27T16:02:00.000Z',
    });
    pushSaveMock.mockResolvedValueOnce({
      ok: false,
      kind: 'conflict',
      serverSave: makeCloudSave({
        profileId: 'remote-alex',
        slot: 'hard',
        revision: 6,
        puzzleId: 'puz-cloud-newer',
        payload: '{"side":"cloud-newer"}',
      }),
    } satisfies PushSaveSlotResult);

    await manager.syncNow(p2.id);
    expect(await listSyncConflicts(p2.id)).toHaveLength(1);

    await manager.resolveConflictKeepCloud(p2.id, 'sudoku', 'hard');
    expect(await listSyncConflicts(p2.id)).toHaveLength(0);
    expect(await storage.loadSave('hard')).toMatchObject({
      baseRevision: 6,
      dirty: false,
      payload: '{"side":"cloud-newer"}',
    });
  });

  it('coalesces concurrent single-flight syncs, debounces moves vs. immediate pause/visibility keepalive, and resets backoff on online', async () => {
    vi.stubGlobal('navigator', { onLine: true });

    const init = await ensureInitialized();
    const localId = init.activeProfile.id;
    const storage = createGameStorageService(localId, 'sudoku');
    await linkLocalProfileToHousehold(localId, {
      id: 'remote-p1',
      householdId: 'hh-1',
      isChild: false,
    });
    await storage.saveGame({
      schemaVersion: 1,
      profileId: localId,
      gameId: 'sudoku',
      slot: 'easy',
      updatedAt: '2026-11-27T16:00:00.000Z',
      summary: { puzzleId: 'puz-1', completed: false, elapsedMs: 1000, filledCells: 5 },
      payload: '{"v":1}',
    });

    let releasePull!: () => void;
    let resolvePullStarted!: () => void;
    const pullStarted = new Promise<void>((resolve) => {
      resolvePullStarted = resolve;
    });
    const pullCalls: number[] = [];
    const api = createMockApi({
      pullProfileSync: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            pullCalls.push(pullCalls.length + 1);
            if (pullCalls.length === 1) {
              resolvePullStarted();
              releasePull = () =>
                resolve({
                  status: 'ok',
                  data: {
                    profileId: 'remote-p1',
                    saves: [],
                    records: [],
                    preferences: null,
                    serverTime: '2026-11-27T16:00:10.000Z',
                  },
                });
              return;
            }
            resolve({
              status: 'ok',
              data: {
                profileId: 'remote-p1',
                saves: [],
                records: [],
                preferences: null,
                serverTime: '2026-11-27T16:00:11.000Z',
              },
            });
          }),
      ),
    });

    const manager = new SyncManager({
      api,
      debounceMs: 60,
      baseBackoffMs: 500,
      maxBackoffMs: 2000,
    });
    const detach = manager.attachWindowListeners();
    manager.setSessionActive(true);
    manager.setActiveProfileId(localId);

    // Three concurrent syncNow calls coalesce into initial pass + 1 rerun (not 3 concurrent passes)
    const p1 = manager.syncNow(localId);
    await pullStarted;
    const p2 = manager.syncNow(localId);
    const p3 = manager.syncNow(localId);

    expect(pullCalls).toEqual([1]);
    releasePull();
    await Promise.all([p1, p2, p3]);
    expect(pullCalls).toEqual([1, 2]);

    // Move trigger debounces for debounceMs before flushing
    const pushSpy = api.pushSaveSlot as ReturnType<typeof vi.fn>;
    pushSpy.mockClear();
    await storage.saveGame({
      schemaVersion: 1,
      profileId: localId,
      gameId: 'sudoku',
      slot: 'easy',
      updatedAt: '2026-11-27T16:01:00.000Z',
      summary: { puzzleId: 'puz-1', completed: false, elapsedMs: 2000, filledCells: 6 },
      payload: '{"v":2}',
    });
    await manager.notifyGameSaved(localId, 'sudoku', 'easy', 'move');
    expect(pushSpy).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 110));
    expect(pushSpy).toHaveBeenCalledTimes(1);

    // Pause and visibility triggers flush immediately, with visibility passing keepalive: true
    pushSpy.mockClear();
    await storage.saveGame({
      schemaVersion: 1,
      profileId: localId,
      gameId: 'sudoku',
      slot: 'easy',
      updatedAt: '2026-11-27T16:02:00.000Z',
      summary: { puzzleId: 'puz-1', completed: false, elapsedMs: 3000, filledCells: 7 },
      payload: '{"v":3}',
    });
    await manager.notifyGameSaved(localId, 'sudoku', 'easy', 'visibility');
    expect(pushSpy).toHaveBeenCalledWith(
      'remote-p1',
      'sudoku',
      'easy',
      expect.anything(),
      expect.objectContaining({ keepalive: true }),
    );

    // Transient error schedules backoff, and window 'online' event triggers immediate retry
    const pullMock = api.pullProfileSync as ReturnType<typeof vi.fn>;
    pullMock.mockResolvedValueOnce({
      status: 'error',
      httpStatus: 500,
      code: 'internal_error',
      message: 'db busy',
    });
    await manager.syncNow(localId);
    expect(manager.getState().status).toBe('error');

    pullMock.mockClear();
    window.dispatchEvent(new Event('online'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pullMock).toHaveBeenCalled();
    expect(manager.getState().status).toBe('idle');

    detach();
  });

  it('applies remote D32 preferences without overwriting local audio and recomputes D31 stats', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const init = await ensureInitialized();
    const localId = init.activeProfile.id;

    const audioCustomSettings: ProfileSettings = {
      ...createDefaultProfileSettings('light'),
      theme: 'clean-minimal',
      sfxEnabled: false,
      sfxVolume: 0.15,
      musicEnabled: true,
      musicVolume: 0.85,
      sudoku: { flagDuplicateConflicts: true, flagWrongValues: false },
    };
    await saveProfileSettings(localId, audioCustomSettings);
    await linkLocalProfileToHousehold(localId, {
      id: 'remote-p1',
      householdId: 'hh-1',
      isChild: false,
    });
    // Clear initial preferencesDirty so pull merges remote settings via LWW
    const syncState = await getProfileSyncState(localId);
    if (syncState) {
      await saveProfileSettings(localId, audioCustomSettings, {
        markPreferencesDirty: false,
        preferencesUpdatedAt: '2026-11-27T15:00:00.000Z',
      });
    }

    const onRemoteSettingsApplied = vi.fn();
    const api = createMockApi({
      pullProfileSync: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          profileId: 'remote-p1',
          saves: [],
          records: [
            {
              profileId: 'remote-p1',
              gameId: 'sudoku',
              puzzleId: 'remote-win-1',
              difficulty: 'medium',
              mode: 'daily',
              dailyDate: '2026-11-27',
              status: 'completed',
              elapsedMs: 90_000,
              hintsUsed: 1,
              startedAt: '2026-11-27T10:00:00Z',
              completedAt: '2026-11-27T10:02:00Z',
              updatedAt: '2026-11-27T10:02:00Z',
            },
          ],
          preferences: {
            profileId: 'remote-p1',
            theme: 'warm-hearthside',
            mode: 'dark',
            gameplay: { sudoku: { flagDuplicateConflicts: false, flagWrongValues: true } },
            updatedAt: '2026-11-27T16:05:00.000Z',
            serverUpdatedAt: '2026-11-27T16:05:01.000Z',
          },
          serverTime: '2026-11-27T16:05:05.000Z',
        },
      }),
    });

    const manager = new SyncManager({ api, onRemoteSettingsApplied });
    manager.setSessionActive(true);
    manager.setActiveProfileId(localId);
    await manager.syncNow(localId);

    const updatedSettings = await getProfileSettings(localId);
    expect(updatedSettings).toEqual({
      theme: 'warm-hearthside',
      mode: 'dark',
      sfxEnabled: false,
      sfxVolume: 0.15,
      musicEnabled: true,
      musicVolume: 0.85,
      sudoku: { flagDuplicateConflicts: false, flagWrongValues: true },
    });
    expect(onRemoteSettingsApplied).toHaveBeenCalledWith(localId, updatedSettings);

    expect(await listPuzzleRecords(localId, 'sudoku')).toHaveLength(1);
    const stats = await createGameStorageService(localId, 'sudoku').loadStats();
    expect(stats?.stats).toMatchObject({
      gamesWon: 1,
      totalHintsUsed: 1,
      dailyCompletedDates: ['2026-11-27'],
    });
  });
});

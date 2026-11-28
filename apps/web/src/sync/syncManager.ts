import {
  extractSyncedPreferences,
  mergePreferencesLWW,
  type CloudSaveRecord,
  type CloudSyncService,
  type Profile,
  type ProfileSettings,
  type PuzzleRecordLogEntry,
  type SaveEnvelope,
  type SaveSummaryMetadata,
  type SyncSaveTriggerReason,
  type SyncStatusState,
} from '@hearthside/game-core';
import { defaultSyncApiClient, isNavigatorOnline } from '../api/client';
import type { PushRecordsBatchItem, SyncApiClient } from '../api/types';
import { shellGameRegistry } from '../games/shellRegistry';
import {
  deleteSyncConflict,
  getProfile,
  getProfileSettings,
  getProfileSyncState,
  getRawSave,
  getStats,
  listAllSavesForProfile,
  listDirtyPuzzleRecords,
  listPuzzleRecords,
  listSyncConflicts,
  markPuzzleRecordsSynced,
  putProfileSyncState,
  putStats,
  putSyncConflict,
  putSyncedSave,
  saveProfileSettings,
  upsertPuzzleRecord,
} from '../storage/hearthsideDb';

const DEFAULT_DEBOUNCE_MS = 3000;
const DEFAULT_BASE_BACKOFF_MS = 2000;
const DEFAULT_MAX_BACKOFF_MS = 60_000;

export interface SyncManagerOptions {
  readonly api?: SyncApiClient;
  readonly debounceMs?: number;
  readonly baseBackoffMs?: number;
  readonly maxBackoffMs?: number;
  readonly extractSaveSummary?: (gameId: string, save: SaveEnvelope) => SaveSummaryMetadata | null;
  readonly recomputeGameStats?: (
    gameId: string,
    records: readonly PuzzleRecordLogEntry[],
    legacyBaseline?: unknown,
  ) => { readonly schemaVersion: number; readonly stats: unknown } | null;
  readonly onRemoteSettingsApplied?: (profileId: string, settings: ProfileSettings) => void;
  readonly onRemoteSavesApplied?: (
    profileId: string,
    gameId: string,
    slots?: readonly string[],
  ) => void;
  readonly onRemoteRecordsApplied?: (profileId: string, gameId: string) => void;
  readonly onUnauthorized?: () => void;
  readonly now?: () => Date;
}

type SyncListener = (state: SyncStatusState) => void;

function defaultExtractSaveSummary(gameId: string, save: SaveEnvelope): SaveSummaryMetadata | null {
  if (
    save.summary &&
    typeof save.summary.puzzleId === 'string' &&
    save.summary.puzzleId.length > 0
  ) {
    return {
      puzzleId: save.summary.puzzleId,
      completed: save.summary.completed ?? false,
      elapsedMs: save.summary.elapsedMs ?? 0,
      filledCells: save.summary.filledCells ?? 0,
    };
  }
  const entry = shellGameRegistry.get(gameId);
  return entry?.extractSaveSummary?.(save.payload) ?? null;
}

function defaultRecomputeGameStats(
  gameId: string,
  records: readonly PuzzleRecordLogEntry[],
  legacyBaseline?: unknown,
): { readonly schemaVersion: number; readonly stats: unknown } | null {
  const entry = shellGameRegistry.get(gameId);
  return entry?.recomputeStats ? entry.recomputeStats(records, legacyBaseline) : null;
}

function formatSlotLabel(slot: string, existingLabel?: string): string | undefined {
  if (existingLabel) {
    return existingLabel;
  }
  if (slot.startsWith('daily:')) {
    const parts = slot.split(':');
    const diff = parts[2] ?? '';
    return diff ? `Daily · ${diff.slice(0, 1).toUpperCase()}${diff.slice(1)}` : 'Daily';
  }
  if (!slot) {
    return undefined;
  }
  return `${slot.slice(0, 1).toUpperCase()}${slot.slice(1)}`;
}

/**
 * Coordinates background D30–D34 cloud synchronization between IndexedDB and the
 * Go server while remaining an unconditional no-op for signed-out or unlinked profiles.
 */
export class SyncManager {
  private readonly api: SyncApiClient;
  private readonly debounceMs: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly extractSaveSummaryFn: (
    gameId: string,
    save: SaveEnvelope,
  ) => SaveSummaryMetadata | null;
  private readonly recomputeGameStatsFn: (
    gameId: string,
    records: readonly PuzzleRecordLogEntry[],
    legacyBaseline?: unknown,
  ) => { readonly schemaVersion: number; readonly stats: unknown } | null;
  private readonly onRemoteSettingsApplied?: (profileId: string, settings: ProfileSettings) => void;
  private readonly onRemoteSavesApplied?: (
    profileId: string,
    gameId: string,
    slots?: readonly string[],
  ) => void;
  private readonly onRemoteRecordsApplied?: (profileId: string, gameId: string) => void;
  private readonly onUnauthorized?: () => void;
  private readonly now: () => Date;

  private signedIn = false;
  private activeProfileId: string | null = null;
  private status: SyncStatusState = {
    status: 'idle',
    pendingCount: 0,
    conflicts: [],
  };
  private readonly listeners = new Set<SyncListener>();
  private readonly inFlightByProfile = new Map<string, Promise<void>>();
  private readonly pendingRerunProfiles = new Map<string, { keepalive: boolean }>();
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private backoffTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffAttempt = 0;
  private listenersAttached = false;

  private readonly handleOnline = () => {
    this.resetBackoff();
    if (this.signedIn && this.activeProfileId) {
      void this.syncNow(this.activeProfileId);
    }
  };

  private readonly handleOffline = () => {
    if (this.activeProfileId) {
      void this.refreshStateForProfile(this.activeProfileId, 'offline');
    } else {
      this.emitState({
        ...this.status,
        status: 'offline',
      });
    }
  };

  private readonly handleVisibilityChange = () => {
    if (
      typeof document !== 'undefined' &&
      document.hidden &&
      this.signedIn &&
      this.activeProfileId
    ) {
      void this.syncNow(this.activeProfileId, { keepalive: true });
    }
  };

  constructor(options: SyncManagerOptions = {}) {
    this.api = options.api ?? defaultSyncApiClient;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.extractSaveSummaryFn = options.extractSaveSummary ?? defaultExtractSaveSummary;
    this.recomputeGameStatsFn = options.recomputeGameStats ?? defaultRecomputeGameStats;
    this.onRemoteSettingsApplied = options.onRemoteSettingsApplied;
    this.onRemoteSavesApplied = options.onRemoteSavesApplied;
    this.onRemoteRecordsApplied = options.onRemoteRecordsApplied;
    this.onUnauthorized = options.onUnauthorized;
    this.now = options.now ?? (() => new Date());
  }

  getState(): SyncStatusState {
    return this.status;
  }

  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitState(next: SyncStatusState): void {
    this.status = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }

  attachWindowListeners(): () => void {
    if (typeof window === 'undefined' || this.listenersAttached) {
      return () => {};
    }
    this.listenersAttached = true;
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    return () => this.detachWindowListeners();
  }

  detachWindowListeners(): void {
    if (typeof window === 'undefined' || !this.listenersAttached) {
      return;
    }
    this.listenersAttached = false;
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.clearAllTimers();
  }

  private clearAllTimers(): void {
    for (const timer of this.debounceTimers.values()) {
      globalThis.clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.clearBackoffTimer();
  }

  private clearBackoffTimer(): void {
    if (this.backoffTimer !== null) {
      globalThis.clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
  }

  private resetBackoff(): void {
    this.backoffAttempt = 0;
    this.clearBackoffTimer();
  }

  private scheduleBackoff(profileId: string): void {
    if (!this.signedIn || !isNavigatorOnline()) {
      return;
    }
    this.clearBackoffTimer();
    const delayMs = Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** this.backoffAttempt);
    this.backoffAttempt += 1;
    this.backoffTimer = globalThis.setTimeout(() => {
      this.backoffTimer = null;
      if (this.signedIn && this.activeProfileId === profileId && isNavigatorOnline()) {
        void this.syncNow(profileId);
      }
    }, delayMs);
  }

  setSessionActive(signedIn: boolean): void {
    this.signedIn = signedIn;
    if (!signedIn) {
      this.clearAllTimers();
      this.pendingRerunProfiles.clear();
      this.backoffAttempt = 0;
      this.emitState({
        status: isNavigatorOnline() ? 'idle' : 'offline',
        pendingCount: 0,
        conflicts: [],
      });
    } else if (this.activeProfileId) {
      void this.refreshStateForProfile(this.activeProfileId);
    }
  }

  setActiveProfileId(profileId: string | null): void {
    this.activeProfileId = profileId;
    if (!profileId) {
      this.emitState({ status: 'idle', pendingCount: 0, conflicts: [] });
      return;
    }
    void this.refreshStateForProfile(profileId);
  }

  private clearDebounceTimersForProfile(profileId: string): void {
    const prefix = `${profileId}:`;
    for (const [key, timer] of this.debounceTimers.entries()) {
      if (key.startsWith(prefix)) {
        globalThis.clearTimeout(timer);
        this.debounceTimers.delete(key);
      }
    }
  }

  private async refreshStateForProfile(
    profileId: string,
    overrideKind?: SyncStatusState['status'],
    lastError?: string,
  ): Promise<SyncStatusState> {
    const [pendingCount, conflicts, syncState] = await Promise.all([
      this.computePendingCount(profileId),
      listSyncConflicts(profileId),
      getProfileSyncState(profileId),
    ]);

    let statusKind: SyncStatusState['status'] = overrideKind ?? 'idle';
    if (!overrideKind) {
      if (conflicts.length > 0) {
        statusKind = 'conflict';
      } else if (!isNavigatorOnline()) {
        statusKind = 'offline';
      }
    }

    const next: SyncStatusState = {
      status: statusKind,
      ...(syncState?.lastSyncedAt ? { lastSyncedAt: syncState.lastSyncedAt } : {}),
      pendingCount,
      conflicts,
      ...(lastError ? { lastError } : {}),
    };
    if (this.activeProfileId === profileId || this.activeProfileId === null) {
      this.emitState(next);
    }
    return next;
  }

  private async computePendingCount(profileId: string): Promise<number> {
    const [dirtyRecords, allSaves, syncState] = await Promise.all([
      listDirtyPuzzleRecords(profileId),
      listAllSavesForProfile(profileId),
      getProfileSyncState(profileId),
    ]);
    const dirtySaves = allSaves.filter((s) => s.dirty).length;
    const prefCount = syncState?.preferencesDirty ? 1 : 0;
    return dirtyRecords.length + dirtySaves + prefCount;
  }

  async syncNow(profileId: string, options?: { readonly keepalive?: boolean }): Promise<void> {
    this.clearDebounceTimersForProfile(profileId);
    this.resetBackoff();

    if (!this.signedIn) {
      return;
    }
    const profile = await getProfile(profileId);
    if (!profile?.remoteProfileId) {
      return;
    }
    if (!isNavigatorOnline()) {
      await this.refreshStateForProfile(profileId, 'offline');
      return;
    }

    const existingFlight = this.inFlightByProfile.get(profileId);
    if (existingFlight) {
      const prev = this.pendingRerunProfiles.get(profileId);
      this.pendingRerunProfiles.set(profileId, {
        keepalive: Boolean(prev?.keepalive || options?.keepalive),
      });
      await existingFlight;
      return;
    }

    const runPromise = this.runSingleFlightLoop(profileId, Boolean(options?.keepalive)).finally(
      () => {
        if (this.inFlightByProfile.get(profileId) === runPromise) {
          this.inFlightByProfile.delete(profileId);
        }
      },
    );
    this.inFlightByProfile.set(profileId, runPromise);
    await runPromise;
  }

  private async runSingleFlightLoop(profileId: string, initialKeepalive: boolean): Promise<void> {
    let keepalive = initialKeepalive;

    // Coalesce concurrent triggers so at most one follow-up pass runs after the active one finishes.
    while (this.signedIn) {
      const profile = await getProfile(profileId);
      if (!profile?.remoteProfileId) {
        this.pendingRerunProfiles.delete(profileId);
        return;
      }
      if (!isNavigatorOnline()) {
        this.pendingRerunProfiles.delete(profileId);
        await this.refreshStateForProfile(profileId, 'offline');
        return;
      }

      await this.executeSyncPass(profile, { keepalive });

      const pending = this.pendingRerunProfiles.get(profileId);
      if (!pending) {
        return;
      }
      this.pendingRerunProfiles.delete(profileId);
      keepalive = pending.keepalive;
    }
  }

  private async executeSyncPass(
    profile: Profile,
    opts: { readonly keepalive: boolean },
  ): Promise<void> {
    const remoteProfileId = profile.remoteProfileId;
    if (!remoteProfileId) {
      return;
    }

    await this.refreshStateForProfile(profile.id, 'syncing');

    const recordsOutcome = await this.pushDirtyRecordsPass(profile.id, remoteProfileId, opts);
    if (recordsOutcome !== 'ok') {
      await this.handlePassFailure(profile.id, recordsOutcome);
      return;
    }

    const prefsOutcome = await this.pushDirtyPreferencesPass(profile.id, remoteProfileId, opts);
    if (prefsOutcome !== 'ok') {
      await this.handlePassFailure(profile.id, prefsOutcome);
      return;
    }

    const savesOutcome = await this.pushDirtySavesPass(profile.id, remoteProfileId, opts);
    if (savesOutcome !== 'ok') {
      await this.handlePassFailure(profile.id, savesOutcome);
      return;
    }

    const pullOutcome = await this.pullRemoteSnapshotPass(profile.id, remoteProfileId);
    if (pullOutcome !== 'ok') {
      await this.handlePassFailure(profile.id, pullOutcome);
      return;
    }

    this.resetBackoff();
    await this.refreshStateForProfile(profile.id);
  }

  private async handlePassFailure(
    profileId: string,
    failure: 'offline' | 'unauthorized' | { readonly error: string },
  ): Promise<void> {
    if (failure === 'unauthorized') {
      this.setSessionActive(false);
      this.onUnauthorized?.();
      return;
    }
    if (failure === 'offline') {
      this.scheduleBackoff(profileId);
      await this.refreshStateForProfile(profileId, 'offline');
      return;
    }
    this.scheduleBackoff(profileId);
    await this.refreshStateForProfile(profileId, 'error', failure.error);
  }

  private async pushDirtyRecordsPass(
    profileId: string,
    remoteProfileId: string,
    opts: { readonly keepalive: boolean },
  ): Promise<'ok' | 'offline' | 'unauthorized' | { readonly error: string }> {
    const dirtyRecords = await listDirtyPuzzleRecords(profileId);
    if (dirtyRecords.length === 0) {
      return 'ok';
    }

    const items: PushRecordsBatchItem[] = dirtyRecords.map((r) => ({
      gameId: r.gameId,
      puzzleId: r.puzzleId,
      difficulty: r.difficulty,
      mode: r.mode,
      ...(r.dailyDate ? { dailyDate: r.dailyDate } : {}),
      status: r.status,
      elapsedMs: r.elapsedMs,
      hintsUsed: r.hintsUsed,
      startedAt: r.startedAt,
      ...(r.completedAt ? { completedAt: r.completedAt } : {}),
    }));

    const res = await this.api.pushRecordsBatch(remoteProfileId, items, opts);
    if (res.status === 'offline' || res.status === 'unavailable') {
      return 'offline';
    }
    if (res.status === 'unauthorized') {
      return 'unauthorized';
    }
    if (res.status !== 'ok') {
      return { error: res.message };
    }

    await markPuzzleRecordsSynced(profileId, res.data.records);
    const gameIds = new Set(res.data.records.map((r) => r.gameId));
    for (const gameId of gameIds) {
      await this.recomputeAndPersistStats(profileId, gameId);
      this.onRemoteRecordsApplied?.(profileId, gameId);
    }
    return 'ok';
  }

  private async pushDirtyPreferencesPass(
    profileId: string,
    remoteProfileId: string,
    opts: { readonly keepalive: boolean },
  ): Promise<'ok' | 'offline' | 'unauthorized' | { readonly error: string }> {
    const syncState = await getProfileSyncState(profileId);
    if (!syncState?.preferencesDirty) {
      return 'ok';
    }

    const localSettings = await getProfileSettings(profileId);
    const localUpdatedAt = syncState.preferencesUpdatedAt ?? this.now().toISOString();
    const prefsPayload = extractSyncedPreferences(localSettings, localUpdatedAt);

    const res = await this.api.pushPreferences(remoteProfileId, prefsPayload, opts);
    if (res.status === 'offline' || res.status === 'unavailable') {
      return 'offline';
    }
    if (res.status === 'unauthorized') {
      return 'unauthorized';
    }
    if (res.status !== 'ok') {
      return { error: res.message };
    }

    if (!res.data.applied) {
      const merged = mergePreferencesLWW(localSettings, localUpdatedAt, res.data.preferences);
      if (merged.appliedRemote) {
        await saveProfileSettings(profileId, merged.settings, {
          markPreferencesDirty: false,
          preferencesUpdatedAt: merged.updatedAt,
        });
        this.onRemoteSettingsApplied?.(profileId, merged.settings);
        return 'ok';
      }
    }

    await putProfileSyncState({
      ...syncState,
      profileId,
      preferencesDirty: false,
      preferencesUpdatedAt: res.data.preferences.updatedAt,
    });
    return 'ok';
  }

  private async pushDirtySavesPass(
    profileId: string,
    remoteProfileId: string,
    opts: { readonly keepalive: boolean },
  ): Promise<'ok' | 'offline' | 'unauthorized' | { readonly error: string }> {
    const [allSaves, existingConflicts] = await Promise.all([
      listAllSavesForProfile(profileId),
      listSyncConflicts(profileId),
    ]);
    const conflictKeys = new Set(existingConflicts.map((c) => `${c.gameId}\u0000${c.slot}`));
    const dirtySaves = allSaves.filter(
      (s) => s.dirty && !conflictKeys.has(`${s.gameId}\u0000${s.slot}`),
    );

    for (const save of dirtySaves) {
      const summaryMeta = this.extractSaveSummaryFn(save.gameId, save);
      const isDeleted = Boolean(save.deleted);
      const puzzleId = summaryMeta?.puzzleId ?? '';
      if (!isDeleted && !puzzleId) {
        // Cannot sync an active save slot without a puzzleId summary; skip without blocking other slots.
        continue;
      }

      const pushRes = await this.api.pushSaveSlot(
        remoteProfileId,
        save.gameId,
        save.slot,
        {
          schemaVersion: save.schemaVersion,
          baseRevision: save.baseRevision ?? 0,
          puzzleId,
          completed: isDeleted ? false : (summaryMeta?.completed ?? false),
          deleted: isDeleted,
          elapsedMs: isDeleted ? 0 : (summaryMeta?.elapsedMs ?? 0),
          filledCells: isDeleted ? 0 : (summaryMeta?.filledCells ?? 0),
          payload: save.payload,
          clientUpdatedAt: save.clientUpdatedAt ?? save.updatedAt,
        },
        opts,
      );

      if (!pushRes.ok) {
        if (pushRes.kind === 'unauthorized') {
          return 'unauthorized';
        }
        if (pushRes.kind === 'offline') {
          return 'offline';
        }
        if (pushRes.kind === 'conflict') {
          await putSyncConflict({
            profileId,
            gameId: save.gameId,
            slot: save.slot,
            localSave: save,
            serverSave: pushRes.serverSave,
            detectedAt: this.now().toISOString(),
          });
          continue;
        }
        if (pushRes.kind === 'too_large') {
          return { error: pushRes.message ?? 'Save payload exceeds server size limit.' };
        }
        return { error: pushRes.message ?? 'Save push failed.' };
      }

      if (pushRes.resolution === 'auto_completed_remote') {
        await this.applyServerSaveLocally(profileId, pushRes.save, save.summary?.label);
      } else {
        await putSyncedSave({
          ...save,
          baseRevision: pushRes.save.revision,
          dirty: false,
          deleted: pushRes.save.deleted,
          payload: pushRes.save.deleted ? null : save.payload,
          clientUpdatedAt: pushRes.save.clientUpdatedAt,
        });
        await deleteSyncConflict(profileId, save.gameId, save.slot);
      }
    }

    return 'ok';
  }

  private async pullRemoteSnapshotPass(
    profileId: string,
    remoteProfileId: string,
  ): Promise<'ok' | 'offline' | 'unauthorized' | { readonly error: string }> {
    const syncState = await getProfileSyncState(profileId);
    const pullRes = await this.api.pullProfileSync(
      remoteProfileId,
      syncState?.lastSyncedAt ? { since: syncState.lastSyncedAt } : undefined,
    );

    if (pullRes.status === 'offline' || pullRes.status === 'unavailable') {
      return 'offline';
    }
    if (pullRes.status === 'unauthorized') {
      return 'unauthorized';
    }
    if (pullRes.status !== 'ok') {
      return { error: pullRes.message };
    }

    const snapshot = pullRes.data;

    if (snapshot.records.length > 0) {
      await markPuzzleRecordsSynced(profileId, snapshot.records);
      const affectedGames = new Set(snapshot.records.map((r) => r.gameId));
      for (const gameId of affectedGames) {
        await this.recomputeAndPersistStats(profileId, gameId);
        this.onRemoteRecordsApplied?.(profileId, gameId);
      }
    }

    if (snapshot.preferences) {
      const localSettings = await getProfileSettings(profileId);
      const latestSyncState = await getProfileSyncState(profileId);
      const merged = mergePreferencesLWW(
        localSettings,
        latestSyncState?.preferencesUpdatedAt,
        snapshot.preferences,
      );
      if (merged.appliedRemote) {
        await saveProfileSettings(profileId, merged.settings, {
          markPreferencesDirty: false,
          preferencesUpdatedAt: merged.updatedAt,
        });
        this.onRemoteSettingsApplied?.(profileId, merged.settings);
      }
    }

    for (const remoteSave of snapshot.saves) {
      const localSave = await getRawSave(profileId, remoteSave.gameId, remoteSave.slot);
      if (!localSave || !localSave.dirty) {
        if (remoteSave.deleted) {
          await putSyncedSave({
            schemaVersion: remoteSave.schemaVersion,
            profileId,
            gameId: remoteSave.gameId,
            slot: remoteSave.slot,
            updatedAt: remoteSave.updatedAt,
            clientUpdatedAt: remoteSave.clientUpdatedAt,
            baseRevision: remoteSave.revision,
            dirty: false,
            deleted: true,
            summary: {
              elapsedMs: 0,
              label: formatSlotLabel(remoteSave.slot, localSave?.summary?.label),
              puzzleId: remoteSave.puzzleId,
              completed: false,
              filledCells: 0,
            },
            payload: null,
          });
          await deleteSyncConflict(profileId, remoteSave.gameId, remoteSave.slot);
          if (localSave && !localSave.deleted) {
            this.onRemoteSavesApplied?.(profileId, remoteSave.gameId, [remoteSave.slot]);
          }
        } else {
          await this.applyServerSaveLocally(profileId, remoteSave, localSave?.summary?.label);
        }
      }
    }

    const afterState = await getProfileSyncState(profileId);
    await putProfileSyncState({
      profileId,
      lastSyncedAt: snapshot.serverTime,
      preferencesDirty: afterState?.preferencesDirty ?? false,
      ...(afterState?.preferencesUpdatedAt
        ? { preferencesUpdatedAt: afterState.preferencesUpdatedAt }
        : {}),
    });

    return 'ok';
  }

  private async applyServerSaveLocally(
    profileId: string,
    serverSave: CloudSaveRecord,
    existingLabel?: string,
  ): Promise<void> {
    await putSyncedSave({
      schemaVersion: serverSave.schemaVersion,
      profileId,
      gameId: serverSave.gameId,
      slot: serverSave.slot,
      updatedAt: serverSave.updatedAt,
      clientUpdatedAt: serverSave.clientUpdatedAt,
      baseRevision: serverSave.revision,
      dirty: false,
      deleted: serverSave.deleted,
      summary: {
        elapsedMs: serverSave.elapsedMs,
        label: formatSlotLabel(serverSave.slot, existingLabel),
        puzzleId: serverSave.puzzleId,
        completed: serverSave.completed,
        filledCells: serverSave.filledCells,
      },
      payload: serverSave.deleted ? null : serverSave.payload,
    });
    await deleteSyncConflict(profileId, serverSave.gameId, serverSave.slot);
    this.onRemoteSavesApplied?.(profileId, serverSave.gameId, [serverSave.slot]);
  }

  private async recomputeAndPersistStats(profileId: string, gameId: string): Promise<void> {
    const [records, existingStats] = await Promise.all([
      listPuzzleRecords(profileId, gameId),
      getStats(profileId, gameId),
    ]);
    const recomputed = this.recomputeGameStatsFn(gameId, records, existingStats?.stats);
    if (!recomputed) {
      return;
    }
    await putStats({
      schemaVersion: recomputed.schemaVersion,
      profileId,
      gameId,
      updatedAt: this.now().toISOString(),
      stats: recomputed.stats,
    });
  }

  async resolveConflictKeepLocal(profileId: string, gameId: string, slot: string): Promise<void> {
    if (!this.signedIn) {
      return;
    }
    const profile = await getProfile(profileId);
    if (!profile?.remoteProfileId) {
      return;
    }
    const [conflicts, localSave] = await Promise.all([
      listSyncConflicts(profileId),
      getRawSave(profileId, gameId, slot),
    ]);
    const conflict = conflicts.find((c) => c.gameId === gameId && c.slot === slot);
    const saveToPush = localSave ?? conflict?.localSave;
    if (!saveToPush) {
      await deleteSyncConflict(profileId, gameId, slot);
      await this.refreshStateForProfile(profileId);
      return;
    }

    const summaryMeta = this.extractSaveSummaryFn(gameId, saveToPush);
    const isDeleted = Boolean(saveToPush.deleted);
    const res = await this.api.pushSaveSlot(profile.remoteProfileId, gameId, slot, {
      schemaVersion: saveToPush.schemaVersion,
      baseRevision: conflict?.serverSave.revision ?? saveToPush.baseRevision ?? 0,
      force: true,
      puzzleId: summaryMeta?.puzzleId ?? '',
      completed: isDeleted ? false : (summaryMeta?.completed ?? false),
      deleted: isDeleted,
      elapsedMs: isDeleted ? 0 : (summaryMeta?.elapsedMs ?? 0),
      filledCells: isDeleted ? 0 : (summaryMeta?.filledCells ?? 0),
      payload: saveToPush.payload,
      clientUpdatedAt: saveToPush.clientUpdatedAt ?? saveToPush.updatedAt,
    });

    if (res.ok) {
      await putSyncedSave({
        ...saveToPush,
        baseRevision: res.save.revision,
        dirty: false,
        deleted: res.save.deleted,
        payload: res.save.deleted ? null : saveToPush.payload,
        clientUpdatedAt: res.save.clientUpdatedAt,
      });
      await deleteSyncConflict(profileId, gameId, slot);
      this.onRemoteSavesApplied?.(profileId, gameId, [slot]);
      await this.refreshStateForProfile(profileId);
      return;
    }

    if (res.kind === 'unauthorized') {
      this.setSessionActive(false);
      this.onUnauthorized?.();
      return;
    }
    await this.refreshStateForProfile(
      profileId,
      res.kind === 'offline' ? 'offline' : 'error',
      res.kind === 'error' || res.kind === 'too_large' ? res.message : undefined,
    );
  }

  async resolveConflictKeepCloud(profileId: string, gameId: string, slot: string): Promise<void> {
    const conflicts = await listSyncConflicts(profileId);
    const conflict = conflicts.find((c) => c.gameId === gameId && c.slot === slot);
    if (!conflict) {
      return;
    }

    await this.applyServerSaveLocally(
      profileId,
      conflict.serverSave,
      conflict.localSave.summary?.label,
    );
    await this.refreshStateForProfile(profileId);
  }

  async notifyGameSaved(
    profileId: string,
    gameId: string,
    slot: string,
    reason: SyncSaveTriggerReason,
  ): Promise<void> {
    if (!this.signedIn) {
      return;
    }
    const profile = await getProfile(profileId);
    if (!profile?.remoteProfileId) {
      return;
    }

    const timerKey = `${profileId}:${gameId}:${slot}`;
    const existingTimer = this.debounceTimers.get(timerKey);
    if (existingTimer !== undefined) {
      globalThis.clearTimeout(existingTimer);
      this.debounceTimers.delete(timerKey);
    }

    if (reason === 'move') {
      const timer = globalThis.setTimeout(() => {
        this.debounceTimers.delete(timerKey);
        void this.syncNow(profileId);
      }, this.debounceMs);
      this.debounceTimers.set(timerKey, timer);
      return;
    }

    await this.syncNow(profileId, { keepalive: reason === 'visibility' });
  }

  notifyPreferencesChanged(profileId: string): void {
    if (!this.signedIn) {
      return;
    }
    void this.syncNow(profileId);
  }

  async recordPuzzleAttempt(
    profileId: string,
    gameId: string,
    entry: Omit<PuzzleRecordLogEntry, 'profileId' | 'updatedAt'> & {
      readonly profileId?: string;
      readonly updatedAt?: string;
    },
  ): Promise<void> {
    const nowIso = entry.updatedAt ?? this.now().toISOString();
    const profile = await getProfile(profileId);
    const isLinked = Boolean(profile?.remoteProfileId);

    await upsertPuzzleRecord(
      {
        ...entry,
        profileId,
        gameId: entry.gameId || gameId,
        updatedAt: nowIso,
      },
      { dirty: isLinked },
    );

    // Completion wins flush immediately via notifyGameSaved(slot, 'complete');
    // start events sync quietly when already online and linked.
    if (this.signedIn && isLinked && entry.status === 'started' && isNavigatorOnline()) {
      void this.syncNow(profileId);
    }
  }

  createGameCloudSyncService(profileId: string, gameId: string): CloudSyncService {
    return {
      requestSync: () => this.syncNow(profileId),
      notifyGameSaved: (slot, reason) => this.notifyGameSaved(profileId, gameId, slot, reason),
      recordPuzzleAttempt: (entry) => this.recordPuzzleAttempt(profileId, gameId, entry),
      getPendingConflicts: () => listSyncConflicts(profileId),
      resolveConflict: (targetGameId, slot, resolution) =>
        resolution === 'local'
          ? this.resolveConflictKeepLocal(profileId, targetGameId, slot)
          : this.resolveConflictKeepCloud(profileId, targetGameId, slot),
    };
  }
}

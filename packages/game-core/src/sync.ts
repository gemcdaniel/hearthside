import {
  isColorMode,
  isThemeId,
  type ColorMode,
  type ProfileSettings,
  type SudokuProfileSettings,
  type ThemeId,
} from './profile';
import type { SaveEnvelope } from './storage';

export interface SaveSummaryMetadata {
  readonly puzzleId: string;
  readonly completed: boolean;
  readonly elapsedMs: number;
  readonly filledCells: number;
}

export interface CloudSaveRecord<TPayload = unknown> {
  readonly profileId: string;
  readonly gameId: string;
  readonly slot: string;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly puzzleId: string;
  readonly completed: boolean;
  readonly deleted: boolean;
  readonly elapsedMs: number;
  readonly filledCells: number;
  readonly payload: TPayload;
  readonly clientUpdatedAt: string;
  readonly updatedAt: string;
}

export interface SaveSyncMetadata {
  readonly baseRevision: number;
  readonly dirty: boolean;
  readonly deleted: boolean;
  readonly clientUpdatedAt: string;
}

export interface SaveSyncConflict<TPayload = unknown> {
  readonly profileId: string;
  readonly gameId: string;
  readonly slot: string;
  readonly localSave: SaveEnvelope<TPayload>;
  readonly serverSave: CloudSaveRecord<TPayload>;
  readonly detectedAt: string;
}

export type PuzzleRecordMode = 'standard' | 'daily';
export type PuzzleRecordStatus = 'started' | 'completed';

export interface PuzzleRecordLogEntry {
  readonly profileId: string;
  readonly gameId: string;
  readonly puzzleId: string;
  readonly difficulty: string;
  readonly mode: PuzzleRecordMode;
  readonly dailyDate?: string;
  readonly status: PuzzleRecordStatus;
  readonly elapsedMs: number;
  readonly hintsUsed: number;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly updatedAt: string;
}

export interface SyncedGameplayPreferences {
  readonly sudoku?: SudokuProfileSettings;
  readonly [gameId: string]: unknown;
}

export interface SyncedProfilePreferences {
  readonly theme: ThemeId;
  readonly mode: ColorMode;
  readonly gameplay: SyncedGameplayPreferences;
  readonly updatedAt: string;
}

export type SyncStatusKind = 'idle' | 'syncing' | 'offline' | 'error' | 'conflict';

export interface SyncStatusState {
  readonly status: SyncStatusKind;
  readonly lastSyncedAt?: string;
  readonly pendingCount: number;
  readonly conflicts: readonly SaveSyncConflict[];
  readonly lastError?: string;
}

export type SyncSaveTriggerReason =
  'move' | 'pause' | 'complete' | 'visibility' | 'manual' | 'delete';

export interface CloudSyncService {
  requestSync(): Promise<void>;
  notifyGameSaved(slot: string, reason: SyncSaveTriggerReason): Promise<void>;
  recordPuzzleAttempt(
    entry: Omit<PuzzleRecordLogEntry, 'profileId' | 'updatedAt'> & {
      readonly profileId?: string;
      readonly updatedAt?: string;
    },
  ): Promise<void>;
  getPendingConflicts(): Promise<readonly SaveSyncConflict[]>;
  resolveConflict(gameId: string, slot: string, resolution: 'local' | 'cloud'): Promise<void>;
}

function compareTimestampStrings(a: string, b: string): number {
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (Number.isFinite(aMs) && Number.isFinite(bMs)) {
    if (aMs !== bMs) {
      return aMs - bMs;
    }
    return 0;
  }
  return a.localeCompare(b);
}

function pickEarlierTimestamp(a: string, b: string): string {
  return compareTimestampStrings(b, a) < 0 ? b : a;
}

function pickLaterTimestamp(a: string, b: string): string {
  return compareTimestampStrings(b, a) > 0 ? b : a;
}

function isIncomingCompletionWinner(
  local: PuzzleRecordLogEntry,
  remote: PuzzleRecordLogEntry,
): boolean {
  if (!local.completedAt && !remote.completedAt) {
    return false;
  }
  if (!local.completedAt) {
    return Boolean(remote.completedAt);
  }
  if (!remote.completedAt) {
    return false;
  }
  const cmp = compareTimestampStrings(remote.completedAt, local.completedAt);
  if (cmp !== 0) {
    return cmp < 0;
  }
  if (remote.elapsedMs !== local.elapsedMs) {
    return remote.elapsedMs < local.elapsedMs;
  }
  return remote.hintsUsed < local.hintsUsed;
}

/**
 * Pure monotonic merge for immutable per-puzzle records (D31), matching the Go server
 * merge rule verbatim:
 * - Never downgrades `completed` to `started`.
 * - Preserves earliest `startedAt` and non-empty `dailyDate`.
 * - When upgrading `started` -> `completed`, accepts completion metadata.
 * - When both are `completed`, keeps earliest `completedAt` (tie-breaking on lower `elapsedMs`, then lower `hintsUsed`).
 */
export function mergePuzzleRecord(
  local: PuzzleRecordLogEntry,
  remote: PuzzleRecordLogEntry,
): PuzzleRecordLogEntry {
  const startedAt = pickEarlierTimestamp(local.startedAt, remote.startedAt);
  const updatedAt = pickLaterTimestamp(local.updatedAt, remote.updatedAt);
  const dailyDate = local.dailyDate ?? remote.dailyDate;

  if (local.status === 'completed' && remote.status === 'started') {
    return {
      ...local,
      dailyDate,
      startedAt,
      updatedAt,
    };
  }

  if (local.status === 'started' && remote.status === 'completed') {
    return {
      ...remote,
      profileId: local.profileId || remote.profileId,
      dailyDate: remote.dailyDate ?? dailyDate,
      startedAt,
      updatedAt,
    };
  }

  if (local.status === 'completed' && remote.status === 'completed') {
    const remoteWins = isIncomingCompletionWinner(local, remote);
    const winner = remoteWins ? remote : local;
    return {
      ...winner,
      profileId: local.profileId || remote.profileId,
      dailyDate: winner.dailyDate ?? dailyDate,
      startedAt,
      updatedAt,
    };
  }

  // Both started: preserve maximum progress and hint count alongside earliest start.
  return {
    ...local,
    dailyDate,
    elapsedMs: Math.max(local.elapsedMs, remote.elapsedMs),
    hintsUsed: Math.max(local.hintsUsed, remote.hintsUsed),
    startedAt,
    updatedAt,
  };
}

/**
 * Idempotent set union over puzzle records keyed by `(gameId, puzzleId)` using `mergePuzzleRecord`,
 * sorted deterministically by `(startedAt, gameId, puzzleId)`.
 */
export function mergePuzzleRecordLists(
  localList: readonly PuzzleRecordLogEntry[],
  remoteList: readonly PuzzleRecordLogEntry[],
): PuzzleRecordLogEntry[] {
  const byKey = new Map<string, PuzzleRecordLogEntry>();

  const ingest = (entry: PuzzleRecordLogEntry) => {
    const key = `${entry.gameId}\u0000${entry.puzzleId}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, entry);
      return;
    }
    byKey.set(key, mergePuzzleRecord(existing, entry));
  };

  for (const item of localList) {
    ingest(item);
  }
  for (const item of remoteList) {
    ingest(item);
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const startCmp = compareTimestampStrings(a.startedAt, b.startedAt);
    if (startCmp !== 0) {
      return startCmp;
    }
    const gameCmp = a.gameId.localeCompare(b.gameId);
    if (gameCmp !== 0) {
      return gameCmp;
    }
    return a.puzzleId.localeCompare(b.puzzleId);
  });
}

/**
 * Extracts only cross-device synced theme and gameplay preferences from full ProfileSettings,
 * intentionally excluding device-local audio settings (D32).
 */
export function extractSyncedPreferences(
  settings: ProfileSettings,
  updatedAt: string,
): SyncedProfilePreferences {
  return {
    theme: settings.theme,
    mode: settings.mode,
    gameplay: {
      sudoku: {
        flagDuplicateConflicts: settings.sudoku.flagDuplicateConflicts,
        flagWrongValues: settings.sudoku.flagWrongValues,
      },
    },
    updatedAt,
  };
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Applies remote synced preferences via Last-Write-Wins (`updatedAt`) while strictly preserving
 * device-local audio mute and volume settings (D32).
 */
export function mergePreferencesLWW(
  localSettings: ProfileSettings,
  localUpdatedAt: string | undefined,
  remotePrefs: SyncedProfilePreferences,
): {
  readonly settings: ProfileSettings;
  readonly updatedAt: string;
  readonly appliedRemote: boolean;
} {
  const remoteMs = Date.parse(remotePrefs.updatedAt);
  if (!Number.isFinite(remoteMs)) {
    return {
      settings: localSettings,
      updatedAt: localUpdatedAt ?? new Date(0).toISOString(),
      appliedRemote: false,
    };
  }

  const localMs = localUpdatedAt ? Date.parse(localUpdatedAt) : Number.NaN;
  if (Number.isFinite(localMs) && remoteMs <= localMs) {
    return {
      settings: localSettings,
      updatedAt: localUpdatedAt as string,
      appliedRemote: false,
    };
  }

  const nextTheme = isThemeId(remotePrefs.theme) ? remotePrefs.theme : localSettings.theme;
  const nextMode = isColorMode(remotePrefs.mode) ? remotePrefs.mode : localSettings.mode;

  let nextSudoku = localSettings.sudoku;
  if (isRecordObject(remotePrefs.gameplay) && isRecordObject(remotePrefs.gameplay.sudoku)) {
    const rawSudoku = remotePrefs.gameplay.sudoku;
    nextSudoku = {
      flagDuplicateConflicts:
        typeof rawSudoku.flagDuplicateConflicts === 'boolean'
          ? rawSudoku.flagDuplicateConflicts
          : localSettings.sudoku.flagDuplicateConflicts,
      flagWrongValues:
        typeof rawSudoku.flagWrongValues === 'boolean'
          ? rawSudoku.flagWrongValues
          : localSettings.sudoku.flagWrongValues,
    };
  }

  return {
    settings: {
      theme: nextTheme,
      mode: nextMode,
      sfxEnabled: localSettings.sfxEnabled,
      sfxVolume: localSettings.sfxVolume,
      musicEnabled: localSettings.musicEnabled,
      musicVolume: localSettings.musicVolume,
      sudoku: nextSudoku,
    },
    updatedAt: remotePrefs.updatedAt,
    appliedRemote: true,
  };
}

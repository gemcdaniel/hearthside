import {
  APP_DISPLAY_NAME,
  createDefaultProfileSettings,
  isAvatarId,
  isColorMode,
  isProfileAccentId,
  isThemeId,
  type AvatarId,
  type CachedPuzzleEntry,
  type CompletedPuzzleRecord,
  type GameStatsRecord,
  type GameStorageService,
  type Profile,
  type ProfileAccentId,
  type ProfileSettings,
  type SaveEnvelope,
} from '@hearthside/game-core';
import { getSystemThemeMode } from '@hearthside/ui';

export { getStoragePersistenceStatus, requestStoragePersistence } from '../diagnostics/indexedDb';

export const HEARTHSIDE_DB_NAME = 'hearthside-db';
export const HEARTHSIDE_DB_VERSION = 3;
export const EXPORT_SCHEMA_VERSION = 1;
export const DEFAULT_PROFILE_ID = 'profile-default-1';
export const DEFAULT_PROFILE_NAME = 'Player 1';
export const ACTIVE_PROFILE_STORAGE_KEY = 'hearthside:active-profile-id';

const STORE_PROFILES = 'profiles';
const STORE_SETTINGS = 'settings';
const STORE_SAVES = 'saves';
const STORE_STATS = 'stats';
const STORE_COMPLETED = 'completedPuzzles';
const STORE_DAILY_PUZZLES = 'dailyPuzzles';
const STORE_SERVER_PUZZLE_BANK = 'serverPuzzleBank';
const STORE_SERVER_SYNC_META = 'serverSyncMeta';

export interface ServerBankPuzzleRecord {
  readonly id: string;
  readonly seed: number;
  readonly engineVersion: string;
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly techniquesRequired: readonly string[];
  readonly clues: string;
  readonly solution: string;
  readonly seq: number;
  readonly cachedAt?: string;
}

export interface ServerSyncMetaRecord {
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly lastSeq: number;
  readonly lastSyncedAt: string;
}

const ALL_STORES = [
  STORE_PROFILES,
  STORE_SETTINGS,
  STORE_SAVES,
  STORE_STATS,
  STORE_COMPLETED,
] as const;

export interface StoredProfileSettingsRecord {
  readonly profileId: string;
  readonly settings: ProfileSettings;
}

export interface HearthsideExportData {
  readonly profiles: readonly Profile[];
  readonly settings: readonly StoredProfileSettingsRecord[];
  readonly saves: readonly SaveEnvelope[];
  readonly stats: readonly GameStatsRecord[];
  readonly completedPuzzles: readonly CompletedPuzzleRecord[];
}

export interface HearthsideExportBundle {
  readonly app: typeof APP_DISPLAY_NAME;
  readonly schemaVersion: number;
  readonly exportedAt: string;
  readonly data: HearthsideExportData;
}

export interface InitializedStorageState {
  readonly profiles: readonly Profile[];
  readonly activeProfile: Profile;
  readonly settings: ProfileSettings;
}

function getIndexedDbFactory(): IDBFactory {
  if (typeof globalThis.indexedDB === 'undefined') {
    throw new Error('IndexedDB is unavailable in this browser context.');
  }
  return globalThis.indexedDB;
}

const openDbConnections = new Set<IDBDatabase>();
let pendingSettingsWrite: Promise<void> = Promise.resolve();
let activeInitPromise: Promise<InitializedStorageState> | null = null;
let settingsWriteSeq = 0;
const latestPendingSettings = new Map<
  string,
  { readonly seq: number; readonly settings: ProfileSettings }
>();

export function openHearthsideDb(): Promise<IDBDatabase> {
  const factory = getIndexedDbFactory();

  return new Promise((resolve, reject) => {
    const request = factory.open(HEARTHSIDE_DB_NAME, HEARTHSIDE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_PROFILES)) {
        db.createObjectStore(STORE_PROFILES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'profileId' });
      }
      if (!db.objectStoreNames.contains(STORE_SAVES)) {
        const saves = db.createObjectStore(STORE_SAVES, {
          keyPath: ['profileId', 'gameId', 'slot'],
        });
        saves.createIndex('by_profile', 'profileId', { unique: false });
        saves.createIndex('by_profile_game', ['profileId', 'gameId'], { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_STATS)) {
        const stats = db.createObjectStore(STORE_STATS, {
          keyPath: ['profileId', 'gameId'],
        });
        stats.createIndex('by_profile', 'profileId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_COMPLETED)) {
        const completed = db.createObjectStore(STORE_COMPLETED, {
          keyPath: ['profileId', 'gameId', 'puzzleId'],
        });
        completed.createIndex('by_profile', 'profileId', { unique: false });
        completed.createIndex('by_profile_game', ['profileId', 'gameId'], { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_DAILY_PUZZLES)) {
        db.createObjectStore(STORE_DAILY_PUZZLES, {
          keyPath: ['gameId', 'cacheKey'],
        });
      }
      if (!db.objectStoreNames.contains(STORE_SERVER_PUZZLE_BANK)) {
        const bank = db.createObjectStore(STORE_SERVER_PUZZLE_BANK, { keyPath: 'id' });
        bank.createIndex('by_difficulty', 'difficulty', { unique: false });
        bank.createIndex('by_difficulty_seq', ['difficulty', 'seq'], { unique: false });
        bank.createIndex('by_seq', 'seq', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_SERVER_SYNC_META)) {
        db.createObjectStore(STORE_SERVER_SYNC_META, { keyPath: 'difficulty' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      openDbConnections.add(db);
      db.onversionchange = () => {
        db.close();
        openDbConnections.delete(db);
      };
      resolve(db);
    };
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open hearthside-db IndexedDB database.'));
  });
}

function requestToPromise<T>(req: IDBRequest<T>, errorMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(errorMessage));
  });
}

function transactionDone(tx: IDBTransaction, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(`${label} transaction failed.`));
    tx.onabort = () => reject(tx.error ?? new Error(`${label} transaction aborted.`));
  });
}

async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openHearthsideDb();
  try {
    return await fn(db);
  } finally {
    db.close();
    openDbConnections.delete(db);
  }
}

function deleteIndexMatches(index: IDBIndex, range: IDBKeyRange): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = index.openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to iterate IndexedDB cursor.'));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isUnitVolume(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isProfile(value: unknown): value is Profile {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.name) &&
    isAvatarId(value.avatarId) &&
    isProfileAccentId(value.accentColor) &&
    isNonEmptyString(value.createdAt) &&
    (value.remoteProfileId === undefined || typeof value.remoteProfileId === 'string') &&
    (value.householdId === undefined || typeof value.householdId === 'string') &&
    (value.isChild === undefined || typeof value.isChild === 'boolean')
  );
}

function isProfileSettings(value: unknown): value is ProfileSettings {
  if (!isRecord(value) || !isRecord(value.sudoku)) {
    return false;
  }
  return (
    isThemeId(value.theme) &&
    isColorMode(value.mode) &&
    typeof value.sfxEnabled === 'boolean' &&
    isUnitVolume(value.sfxVolume) &&
    typeof value.musicEnabled === 'boolean' &&
    isUnitVolume(value.musicVolume) &&
    typeof value.sudoku.flagDuplicateConflicts === 'boolean' &&
    typeof value.sudoku.flagWrongValues === 'boolean'
  );
}

function isStoredProfileSettingsRecord(value: unknown): value is StoredProfileSettingsRecord {
  if (!isRecord(value)) {
    return false;
  }
  return isNonEmptyString(value.profileId) && isProfileSettings(value.settings);
}

function isSaveSlotSummary(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.elapsedMs === undefined ||
      (typeof value.elapsedMs === 'number' &&
        Number.isFinite(value.elapsedMs) &&
        value.elapsedMs >= 0)) &&
    (value.label === undefined || typeof value.label === 'string')
  );
}

function isSaveEnvelope(value: unknown): value is SaveEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.schemaVersion === 'number' &&
    Number.isInteger(value.schemaVersion) &&
    value.schemaVersion >= 1 &&
    isNonEmptyString(value.profileId) &&
    isNonEmptyString(value.gameId) &&
    isNonEmptyString(value.slot) &&
    isNonEmptyString(value.updatedAt) &&
    isSaveSlotSummary(value.summary) &&
    'payload' in value
  );
}

function isGameStatsRecord(value: unknown): value is GameStatsRecord {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.schemaVersion === 'number' &&
    Number.isInteger(value.schemaVersion) &&
    value.schemaVersion >= 1 &&
    isNonEmptyString(value.profileId) &&
    isNonEmptyString(value.gameId) &&
    isNonEmptyString(value.updatedAt) &&
    'stats' in value
  );
}

function isCompletedPuzzleRecord(value: unknown): value is CompletedPuzzleRecord {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.profileId) &&
    isNonEmptyString(value.gameId) &&
    isNonEmptyString(value.puzzleId) &&
    (value.difficulty === undefined || typeof value.difficulty === 'string') &&
    (value.mode === undefined || value.mode === 'standard' || value.mode === 'daily') &&
    (value.dailyDate === undefined || typeof value.dailyDate === 'string') &&
    isNonEmptyString(value.completedAt) &&
    typeof value.elapsedMs === 'number' &&
    Number.isFinite(value.elapsedMs) &&
    value.elapsedMs >= 0 &&
    typeof value.hintsUsed === 'number' &&
    Number.isFinite(value.hintsUsed) &&
    value.hintsUsed >= 0
  );
}

function isCachedPuzzleEntry(value: unknown): value is CachedPuzzleEntry {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.gameId) &&
    isNonEmptyString(value.cacheKey) &&
    isNonEmptyString(value.cachedAt) &&
    'puzzle' in value
  );
}

export function getStoredActiveProfileId(): string | null {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }
  try {
    const id = window.localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY);
    return id && id.trim().length > 0 ? id : null;
  } catch {
    return null;
  }
}

export function setStoredActiveProfileId(profileId: string): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, profileId);
  } catch {
    // Ignore storage restriction errors.
  }
}

function generateProfileId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `profile-${globalThis.crypto.randomUUID()}`;
  }
  return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function listProfiles(): Promise<Profile[]> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE_PROFILES, 'readonly');
    const store = tx.objectStore(STORE_PROFILES);
    const raw = (await requestToPromise(store.getAll(), 'Failed to list profiles.')) as unknown[];
    return raw.filter(isProfile).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  });
}

export async function getProfile(profileId: string): Promise<Profile | null> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE_PROFILES, 'readonly');
    const raw: unknown = await requestToPromise(
      tx.objectStore(STORE_PROFILES).get(profileId),
      'Failed to read profile.',
    );
    return isProfile(raw) ? raw : null;
  });
}

async function readProfileSettingsFromDb(profileId: string): Promise<ProfileSettings> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE_SETTINGS, 'readonly');
    const raw: unknown = await requestToPromise(
      tx.objectStore(STORE_SETTINGS).get(profileId),
      'Failed to read profile settings.',
    );
    if (isStoredProfileSettingsRecord(raw)) {
      return raw.settings;
    }
    return createDefaultProfileSettings(getSystemThemeMode());
  });
}

export async function getProfileSettings(profileId: string): Promise<ProfileSettings> {
  await pendingSettingsWrite.catch(() => {});
  return readProfileSettingsFromDb(profileId);
}

export async function saveProfileSettings(
  profileId: string,
  settings: ProfileSettings,
): Promise<void> {
  if (!isProfileSettings(settings)) {
    throw new Error('Invalid profile settings payload.');
  }
  settingsWriteSeq += 1;
  const seq = settingsWriteSeq;
  latestPendingSettings.set(profileId, { seq, settings });

  const initBarrier = activeInitPromise ?? Promise.resolve();
  const writeOp = pendingSettingsWrite
    .catch(() => {})
    .then(() => initBarrier.catch(() => {}))
    .then(() =>
      withDb(async (db) => {
        const tx = db.transaction(STORE_SETTINGS, 'readwrite');
        const record: StoredProfileSettingsRecord = { profileId, settings };
        tx.objectStore(STORE_SETTINGS).put(record);
        await transactionDone(tx, 'Save profile settings');
      }),
    )
    .finally(() => {
      if (latestPendingSettings.get(profileId)?.seq === seq) {
        latestPendingSettings.delete(profileId);
      }
    });
  pendingSettingsWrite = writeOp;
  await writeOp;
}

export interface CreateProfileInput {
  readonly id?: string;
  readonly name: string;
  readonly avatarId?: AvatarId;
  readonly accentColor?: ProfileAccentId;
  readonly settings?: ProfileSettings;
  readonly remoteProfileId?: string;
  readonly householdId?: string;
  readonly isChild?: boolean;
}

export async function createProfile(input: CreateProfileInput): Promise<Profile> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error('Profile name must not be empty.');
  }

  const profile: Profile = {
    id: input.id?.trim() || generateProfileId(),
    name: trimmedName,
    avatarId: input.avatarId ?? 'hearth',
    accentColor: input.accentColor ?? 'cobalt',
    createdAt: new Date().toISOString(),
    ...(input.remoteProfileId ? { remoteProfileId: input.remoteProfileId } : {}),
    ...(input.householdId ? { householdId: input.householdId } : {}),
    ...(input.isChild !== undefined ? { isChild: input.isChild } : {}),
  };
  const settings = input.settings ?? createDefaultProfileSettings(getSystemThemeMode());

  await withDb(async (db) => {
    const tx = db.transaction([STORE_PROFILES, STORE_SETTINGS], 'readwrite');
    tx.objectStore(STORE_PROFILES).put(profile);
    tx.objectStore(STORE_SETTINGS).put({ profileId: profile.id, settings });
    await transactionDone(tx, 'Create profile');
  });

  return profile;
}

export interface RemoteProfileLinkTarget {
  readonly id: string;
  readonly householdId: string;
  readonly name: string;
  readonly avatarId: string;
  readonly accentColor: string;
  readonly isChild: boolean;
}

/**
 * Links an existing local profile to a remote household profile without deleting
 * or overwriting local saves, settings, stats, or completed puzzles (D29).
 */
export async function linkLocalProfileToRemote(
  localProfileId: string,
  remote: Pick<RemoteProfileLinkTarget, 'id' | 'householdId' | 'isChild'>,
): Promise<Profile> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE_PROFILES, 'readwrite');
    const store = tx.objectStore(STORE_PROFILES);
    const existing: unknown = await requestToPromise(
      store.get(localProfileId),
      'Failed to load profile for linking.',
    );
    if (!isProfile(existing)) {
      throw new Error(`Profile "${localProfileId}" does not exist.`);
    }

    const updated: Profile = {
      ...existing,
      remoteProfileId: remote.id,
      householdId: remote.householdId,
      isChild: remote.isChild,
    };
    store.put(updated);
    await transactionDone(tx, 'Link local profile');
    return updated;
  });
}

/**
 * Clears remote household link metadata from a local profile while keeping all
 * local saves, settings, and stats untouched (D29).
 */
export async function unlinkLocalProfile(localProfileId: string): Promise<Profile> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE_PROFILES, 'readwrite');
    const store = tx.objectStore(STORE_PROFILES);
    const existing: unknown = await requestToPromise(
      store.get(localProfileId),
      'Failed to load profile for unlinking.',
    );
    if (!isProfile(existing)) {
      throw new Error(`Profile "${localProfileId}" does not exist.`);
    }

    const updated: Profile = {
      id: existing.id,
      name: existing.name,
      avatarId: existing.avatarId,
      accentColor: existing.accentColor,
      createdAt: existing.createdAt,
    };
    store.put(updated);
    await transactionDone(tx, 'Unlink local profile');
    return updated;
  });
}

/**
 * Adds a household profile to this device as a new pre-linked local profile.
 * Child profiles default `flagWrongValues` to ON for kid-friendly play (D9/D21).
 */
export async function addRemoteProfileToDevice(
  remote: RemoteProfileLinkTarget,
  defaultMode: 'light' | 'dark' = getSystemThemeMode(),
): Promise<{
  readonly profile: Profile;
  readonly settings: ProfileSettings;
  readonly created: boolean;
}> {
  const existingProfiles = await listProfiles();
  const alreadyLinked = existingProfiles.find((p) => p.remoteProfileId === remote.id);
  if (alreadyLinked) {
    const existingSettings = await getProfileSettings(alreadyLinked.id);
    return { profile: alreadyLinked, settings: existingSettings, created: false };
  }

  const avatarId: AvatarId = isAvatarId(remote.avatarId) ? remote.avatarId : 'hearth';
  const accentColor: ProfileAccentId = isProfileAccentId(remote.accentColor)
    ? remote.accentColor
    : 'cobalt';
  const baseSettings = createDefaultProfileSettings(defaultMode);
  const settings: ProfileSettings = {
    ...baseSettings,
    sudoku: {
      ...baseSettings.sudoku,
      flagWrongValues: remote.isChild ? true : baseSettings.sudoku.flagWrongValues,
    },
  };

  const profile = await createProfile({
    name: remote.name,
    avatarId,
    accentColor,
    settings,
    remoteProfileId: remote.id,
    householdId: remote.householdId,
    isChild: remote.isChild,
  });

  return { profile, settings, created: true };
}

export interface UpdateProfileInput {
  readonly name?: string;
  readonly avatarId?: AvatarId;
  readonly accentColor?: ProfileAccentId;
}

export async function updateProfile(
  profileId: string,
  updates: UpdateProfileInput,
): Promise<Profile> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE_PROFILES, 'readwrite');
    const store = tx.objectStore(STORE_PROFILES);
    const existing: unknown = await requestToPromise(
      store.get(profileId),
      'Failed to load profile for update.',
    );
    if (!isProfile(existing)) {
      throw new Error(`Profile "${profileId}" does not exist.`);
    }

    const nextName = updates.name !== undefined ? updates.name.trim() : existing.name;
    if (!nextName) {
      throw new Error('Profile name must not be empty.');
    }

    const updated: Profile = {
      ...existing,
      name: nextName,
      avatarId: updates.avatarId ?? existing.avatarId,
      accentColor: updates.accentColor ?? existing.accentColor,
    };
    store.put(updated);
    await transactionDone(tx, 'Update profile');
    return updated;
  });
}

export async function deleteProfile(profileId: string): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction([...ALL_STORES], 'readwrite');
    const profilesStore = tx.objectStore(STORE_PROFILES);
    const allProfiles = (await requestToPromise(
      profilesStore.getAll(),
      'Failed to check remaining profiles.',
    )) as unknown[];
    const validProfiles = allProfiles.filter(isProfile);
    if (!validProfiles.some((p) => p.id === profileId)) {
      throw new Error(`Profile "${profileId}" does not exist.`);
    }
    if (validProfiles.length <= 1) {
      throw new Error('Cannot delete the last remaining profile.');
    }

    profilesStore.delete(profileId);
    tx.objectStore(STORE_SETTINGS).delete(profileId);

    const range = IDBKeyRange.only(profileId);
    await deleteIndexMatches(tx.objectStore(STORE_SAVES).index('by_profile'), range);
    await deleteIndexMatches(tx.objectStore(STORE_STATS).index('by_profile'), range);
    await deleteIndexMatches(tx.objectStore(STORE_COMPLETED).index('by_profile'), range);

    await transactionDone(tx, 'Delete profile');
  });
}

export async function ensureInitialized(): Promise<InitializedStorageState> {
  if (activeInitPromise) {
    return activeInitPromise;
  }

  const runInit = async (): Promise<InitializedStorageState> => {
    await pendingSettingsWrite.catch(() => {});
    const defaultMode = getSystemThemeMode();

    const existing = await listProfiles();
    if (existing.length === 0) {
      const seedProfile: Profile = {
        id: DEFAULT_PROFILE_ID,
        name: DEFAULT_PROFILE_NAME,
        avatarId: 'hearth',
        accentColor: 'cobalt',
        createdAt: new Date().toISOString(),
      };
      const seedSettings = createDefaultProfileSettings(defaultMode);

      await withDb(async (db) => {
        const tx = db.transaction([STORE_PROFILES, STORE_SETTINGS], 'readwrite');
        tx.objectStore(STORE_PROFILES).put(seedProfile);
        tx.objectStore(STORE_SETTINGS).put({
          profileId: seedProfile.id,
          settings: seedSettings,
        });
        await transactionDone(tx, 'Seed default profile');
      });

      setStoredActiveProfileId(seedProfile.id);
      const pendingOverride = latestPendingSettings.get(seedProfile.id);
      return {
        profiles: [seedProfile],
        activeProfile: seedProfile,
        settings: pendingOverride ? pendingOverride.settings : seedSettings,
      };
    }

    const storedId = getStoredActiveProfileId();
    const firstProfile = existing[0];
    if (!firstProfile) {
      throw new Error('Unexpected empty profiles list after initialization.');
    }
    const activeProfile = existing.find((p) => p.id === storedId) ?? firstProfile;
    if (activeProfile.id !== storedId) {
      setStoredActiveProfileId(activeProfile.id);
    }
    const settings = await readProfileSettingsFromDb(activeProfile.id);
    const pendingOverride = latestPendingSettings.get(activeProfile.id);

    return {
      profiles: existing,
      activeProfile,
      settings: pendingOverride ? pendingOverride.settings : settings,
    };
  };

  activeInitPromise = runInit().finally(() => {
    activeInitPromise = null;
  });
  return activeInitPromise;
}

export async function getSave<TPayload = unknown>(
  profileId: string,
  gameId: string,
  slot: string,
): Promise<SaveEnvelope<TPayload> | null> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE_SAVES, 'readonly');
    const raw: unknown = await requestToPromise(
      tx.objectStore(STORE_SAVES).get([profileId, gameId, slot]),
      'Failed to read save slot.',
    );
    return isSaveEnvelope(raw) ? (raw as SaveEnvelope<TPayload>) : null;
  });
}

export async function putSave<TPayload = unknown>(envelope: SaveEnvelope<TPayload>): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(STORE_SAVES, 'readwrite');
    tx.objectStore(STORE_SAVES).put(envelope);
    await transactionDone(tx, 'Save game');
  });
}

export async function deleteSave(profileId: string, gameId: string, slot: string): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(STORE_SAVES, 'readwrite');
    tx.objectStore(STORE_SAVES).delete([profileId, gameId, slot]);
    await transactionDone(tx, 'Delete save slot');
  });
}

export async function listSavesForProfileGame(
  profileId: string,
  gameId: string,
): Promise<SaveEnvelope[]> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE_SAVES, 'readonly');
    const index = tx.objectStore(STORE_SAVES).index('by_profile_game');
    const raw = (await requestToPromise(
      index.getAll([profileId, gameId]),
      'Failed to list save slots.',
    )) as unknown[];
    return raw.filter(isSaveEnvelope);
  });
}

export async function getStats<TStats = unknown>(
  profileId: string,
  gameId: string,
): Promise<GameStatsRecord<TStats> | null> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE_STATS, 'readonly');
    const raw: unknown = await requestToPromise(
      tx.objectStore(STORE_STATS).get([profileId, gameId]),
      'Failed to read game stats.',
    );
    return isGameStatsRecord(raw) ? (raw as GameStatsRecord<TStats>) : null;
  });
}

export async function putStats<TStats = unknown>(record: GameStatsRecord<TStats>): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(STORE_STATS, 'readwrite');
    tx.objectStore(STORE_STATS).put(record);
    await transactionDone(tx, 'Save game stats');
  });
}

export async function putCompletedPuzzle(record: CompletedPuzzleRecord): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(STORE_COMPLETED, 'readwrite');
    tx.objectStore(STORE_COMPLETED).put(record);
    await transactionDone(tx, 'Record completed puzzle');
  });
}

export async function listCompletedPuzzles(
  profileId: string,
  gameId: string,
): Promise<CompletedPuzzleRecord[]> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE_COMPLETED, 'readonly');
    const index = tx.objectStore(STORE_COMPLETED).index('by_profile_game');
    const raw = (await requestToPromise(
      index.getAll([profileId, gameId]),
      'Failed to list completed puzzles.',
    )) as unknown[];
    return raw.filter(isCompletedPuzzleRecord);
  });
}

export async function getCachedPuzzle<TPuzzle = unknown>(
  gameId: string,
  cacheKey: string,
): Promise<TPuzzle | null> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE_DAILY_PUZZLES, 'readonly');
    const raw: unknown = await requestToPromise(
      tx.objectStore(STORE_DAILY_PUZZLES).get([gameId, cacheKey]),
      'Failed to read cached puzzle.',
    );
    return isCachedPuzzleEntry(raw) ? (raw.puzzle as TPuzzle) : null;
  });
}

export async function putCachedPuzzle<TPuzzle = unknown>(
  gameId: string,
  cacheKey: string,
  puzzle: TPuzzle,
): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(STORE_DAILY_PUZZLES, 'readwrite');
    const entry: CachedPuzzleEntry<TPuzzle> = {
      gameId,
      cacheKey,
      cachedAt: new Date().toISOString(),
      puzzle,
    };
    tx.objectStore(STORE_DAILY_PUZZLES).put(entry);
    await transactionDone(tx, 'Cache puzzle record');
  });
}

export async function putServerBankPuzzles(
  difficulty: 'easy' | 'medium' | 'hard',
  items: readonly ServerBankPuzzleRecord[],
  nextSeq: number,
): Promise<void> {
  const now = new Date().toISOString();
  await withDb(async (db) => {
    const tx = db.transaction([STORE_SERVER_PUZZLE_BANK, STORE_SERVER_SYNC_META], 'readwrite');
    const bankStore = tx.objectStore(STORE_SERVER_PUZZLE_BANK);
    for (const item of items) {
      bankStore.put({
        ...item,
        difficulty,
        cachedAt: item.cachedAt ?? now,
      });
    }
    const meta: ServerSyncMetaRecord = {
      difficulty,
      lastSeq: nextSeq,
      lastSyncedAt: now,
    };
    tx.objectStore(STORE_SERVER_SYNC_META).put(meta);
    await transactionDone(tx, 'Store server puzzle bank batch');
  });
}

export async function listServerBankPuzzles<TPuzzle = ServerBankPuzzleRecord>(
  difficulty: 'easy' | 'medium' | 'hard',
): Promise<TPuzzle[]> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE_SERVER_PUZZLE_BANK, 'readonly');
    const index = tx.objectStore(STORE_SERVER_PUZZLE_BANK).index('by_difficulty_seq');
    const range = IDBKeyRange.bound([difficulty, 0], [difficulty, Number.MAX_SAFE_INTEGER]);
    const raw = (await requestToPromise(
      index.getAll(range),
      'Failed to list cached server bank puzzles.',
    )) as unknown[];
    return raw.filter(isRecord) as unknown as TPuzzle[];
  });
}

export async function getServerSyncMeta(
  difficulty: 'easy' | 'medium' | 'hard',
): Promise<ServerSyncMetaRecord | null> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE_SERVER_SYNC_META, 'readonly');
    const raw: unknown = await requestToPromise(
      tx.objectStore(STORE_SERVER_SYNC_META).get(difficulty),
      'Failed to read server sync metadata.',
    );
    if (
      isRecord(raw) &&
      typeof raw.lastSeq === 'number' &&
      isNonEmptyString(raw.lastSyncedAt) &&
      (raw.difficulty === 'easy' || raw.difficulty === 'medium' || raw.difficulty === 'hard')
    ) {
      return raw as unknown as ServerSyncMetaRecord;
    }
    return null;
  });
}

export async function countServerBankPuzzles(): Promise<{
  readonly total: number;
  readonly easy: number;
  readonly medium: number;
  readonly hard: number;
}> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE_SERVER_PUZZLE_BANK, 'readonly');
    const index = tx.objectStore(STORE_SERVER_PUZZLE_BANK).index('by_difficulty');
    const [easy, medium, hard] = await Promise.all([
      requestToPromise(index.count('easy'), 'Count easy server puzzles'),
      requestToPromise(index.count('medium'), 'Count medium server puzzles'),
      requestToPromise(index.count('hard'), 'Count hard server puzzles'),
    ]);
    return {
      total: easy + medium + hard,
      easy,
      medium,
      hard,
    };
  });
}

export function createGameStorageService(profileId: string, gameId: string): GameStorageService {
  return {
    loadSave: <TPayload = unknown>(slot: string) => getSave<TPayload>(profileId, gameId, slot),
    saveGame: <TPayload = unknown>(envelope: SaveEnvelope<TPayload>) =>
      putSave({
        ...envelope,
        profileId,
        gameId,
      }),
    deleteSave: (slot: string) => deleteSave(profileId, gameId, slot),
    listSaves: () => listSavesForProfileGame(profileId, gameId),
    loadStats: <TStats = unknown>() => getStats<TStats>(profileId, gameId),
    saveStats: <TStats = unknown>(record: GameStatsRecord<TStats>) =>
      putStats({
        ...record,
        profileId,
        gameId,
      }),
    recordCompletedPuzzle: (record: CompletedPuzzleRecord) =>
      putCompletedPuzzle({
        ...record,
        profileId,
        gameId,
      }),
    listCompletedPuzzles: () => listCompletedPuzzles(profileId, gameId),
    loadCachedPuzzle: <TPuzzle = unknown>(cacheKey: string) =>
      getCachedPuzzle<TPuzzle>(gameId, cacheKey),
    saveCachedPuzzle: <TPuzzle = unknown>(cacheKey: string, puzzle: TPuzzle) =>
      putCachedPuzzle<TPuzzle>(gameId, cacheKey, puzzle),
  };
}

export async function exportAllData(): Promise<string> {
  const data = await withDb(async (db) => {
    const tx = db.transaction([...ALL_STORES], 'readonly');
    const [profilesRaw, settingsRaw, savesRaw, statsRaw, completedRaw] = await Promise.all([
      requestToPromise(tx.objectStore(STORE_PROFILES).getAll(), 'Export profiles'),
      requestToPromise(tx.objectStore(STORE_SETTINGS).getAll(), 'Export settings'),
      requestToPromise(tx.objectStore(STORE_SAVES).getAll(), 'Export saves'),
      requestToPromise(tx.objectStore(STORE_STATS).getAll(), 'Export stats'),
      requestToPromise(tx.objectStore(STORE_COMPLETED).getAll(), 'Export completed puzzles'),
    ]);

    return {
      profiles: (profilesRaw as unknown[]).filter(isProfile),
      settings: (settingsRaw as unknown[]).filter(isStoredProfileSettingsRecord),
      saves: (savesRaw as unknown[]).filter(isSaveEnvelope),
      stats: (statsRaw as unknown[]).filter(isGameStatsRecord),
      completedPuzzles: (completedRaw as unknown[]).filter(isCompletedPuzzleRecord),
    };
  });

  const bundle: HearthsideExportBundle = {
    app: APP_DISPLAY_NAME,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
  return JSON.stringify(bundle, null, 2);
}

export function validateImportBundle(raw: unknown): HearthsideExportBundle {
  if (!isRecord(raw)) {
    throw new Error('Import file must be a JSON object.');
  }
  if (raw.app !== APP_DISPLAY_NAME) {
    throw new Error(`Unsupported export app identifier; expected "${APP_DISPLAY_NAME}".`);
  }
  if (raw.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    throw new Error(`Unsupported backup schemaVersion "${String(raw.schemaVersion)}".`);
  }
  if (!isNonEmptyString(raw.exportedAt)) {
    throw new Error('Import bundle is missing exportedAt timestamp.');
  }
  if (!isRecord(raw.data)) {
    throw new Error('Import bundle is missing data payload.');
  }

  const { profiles, settings, saves, stats, completedPuzzles } = raw.data;
  if (
    !Array.isArray(profiles) ||
    !Array.isArray(settings) ||
    !Array.isArray(saves) ||
    !Array.isArray(stats) ||
    !Array.isArray(completedPuzzles)
  ) {
    throw new Error('Import data must include array collections for all stores.');
  }
  if (profiles.length === 0) {
    throw new Error('Import backup must include at least one profile.');
  }

  const profileIds = new Set<string>();
  const validatedProfiles: Profile[] = [];
  for (const item of profiles) {
    if (!isProfile(item)) {
      throw new Error('Import backup contains an invalid profile record.');
    }
    if (profileIds.has(item.id)) {
      throw new Error(`Import backup contains duplicate profile id "${item.id}".`);
    }
    profileIds.add(item.id);
    validatedProfiles.push(item);
  }

  const seenSettings = new Set<string>();
  const validatedSettings: StoredProfileSettingsRecord[] = [];
  for (const item of settings) {
    if (!isStoredProfileSettingsRecord(item) || !profileIds.has(item.profileId)) {
      throw new Error('Import backup contains an invalid settings record.');
    }
    if (seenSettings.has(item.profileId)) {
      throw new Error(`Duplicate settings entry for profile "${item.profileId}".`);
    }
    seenSettings.add(item.profileId);
    validatedSettings.push(item);
  }

  const validatedSaves: SaveEnvelope[] = [];
  for (const item of saves) {
    if (!isSaveEnvelope(item) || !profileIds.has(item.profileId)) {
      throw new Error('Import backup contains an invalid game save record.');
    }
    validatedSaves.push(item);
  }

  const validatedStats: GameStatsRecord[] = [];
  for (const item of stats) {
    if (!isGameStatsRecord(item) || !profileIds.has(item.profileId)) {
      throw new Error('Import backup contains an invalid stats record.');
    }
    validatedStats.push(item);
  }

  const validatedCompleted: CompletedPuzzleRecord[] = [];
  for (const item of completedPuzzles) {
    if (!isCompletedPuzzleRecord(item) || !profileIds.has(item.profileId)) {
      throw new Error('Import backup contains an invalid completed puzzle record.');
    }
    validatedCompleted.push(item);
  }

  return {
    app: APP_DISPLAY_NAME,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: raw.exportedAt,
    data: {
      profiles: validatedProfiles,
      settings: validatedSettings,
      saves: validatedSaves,
      stats: validatedStats,
      completedPuzzles: validatedCompleted,
    },
  };
}

export async function importAllData(json: string): Promise<HearthsideExportBundle> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new Error('Selected file is not valid JSON.');
  }

  const bundle = validateImportBundle(parsed);

  await withDb(async (db) => {
    const tx = db.transaction([...ALL_STORES], 'readwrite');
    for (const storeName of ALL_STORES) {
      tx.objectStore(storeName).clear();
    }

    const profilesStore = tx.objectStore(STORE_PROFILES);
    for (const profile of bundle.data.profiles) {
      profilesStore.put(profile);
    }

    const settingsStore = tx.objectStore(STORE_SETTINGS);
    for (const setting of bundle.data.settings) {
      settingsStore.put(setting);
    }

    const savesStore = tx.objectStore(STORE_SAVES);
    for (const save of bundle.data.saves) {
      savesStore.put(save);
    }

    const statsStore = tx.objectStore(STORE_STATS);
    for (const stat of bundle.data.stats) {
      statsStore.put(stat);
    }

    const completedStore = tx.objectStore(STORE_COMPLETED);
    for (const completed of bundle.data.completedPuzzles) {
      completedStore.put(completed);
    }

    await transactionDone(tx, 'Import Hearthside backup');
  });

  const currentActive = getStoredActiveProfileId();
  const firstImported = bundle.data.profiles[0];
  if (firstImported && !bundle.data.profiles.some((p) => p.id === currentActive)) {
    setStoredActiveProfileId(firstImported.id);
  }

  return bundle;
}

export async function resetHearthsideDbForTests(): Promise<void> {
  await activeInitPromise?.catch(() => {});
  activeInitPromise = null;
  await pendingSettingsWrite.catch(() => {});
  pendingSettingsWrite = Promise.resolve();
  latestPendingSettings.clear();
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.removeItem(ACTIVE_PROFILE_STORAGE_KEY);
    } catch {
      // Ignore cleanup errors.
    }
  }
  if (typeof globalThis.indexedDB === 'undefined') {
    return;
  }
  for (const db of openDbConnections) {
    db.close();
    openDbConnections.delete(db);
  }
  await new Promise<void>((resolve, reject) => {
    const req = globalThis.indexedDB.deleteDatabase(HEARTHSIDE_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('Failed to delete hearthside-db.'));
    req.onblocked = () => resolve();
  });
}

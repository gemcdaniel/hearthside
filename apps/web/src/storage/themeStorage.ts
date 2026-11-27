import {
  DEFAULT_THEME_NAME,
  getSystemThemeMode,
  isThemeMode,
  isThemeName,
  type ThemePreference,
} from '@hearthside/ui';

export const THEME_STORAGE_KEY = 'hearthside:theme-preference';

const PREF_DB_NAME = 'hearthside-preferences';
const PREF_DB_VERSION = 1;
const PREF_STORE_NAME = 'preferences';
const PREF_RECORD_KEY = 'theme';

function parseThemePreference(raw: unknown): ThemePreference | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (!isThemeName(record.theme) || !isThemeMode(record.mode)) {
    return null;
  }
  return {
    theme: record.theme,
    mode: record.mode,
  };
}

export function loadInitialThemePreference(): ThemePreference {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (raw) {
        const parsed = parseThemePreference(JSON.parse(raw) as unknown);
        if (parsed) {
          return parsed;
        }
      }
    } catch {
      // Ignore malformed localStorage or restricted storage environments.
    }
  }

  return {
    theme: DEFAULT_THEME_NAME,
    mode: getSystemThemeMode(),
  };
}

function openPreferencesDb(): Promise<IDBDatabase | null> {
  if (typeof globalThis.indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(PREF_DB_NAME, PREF_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PREF_STORE_NAME)) {
        db.createObjectStore(PREF_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open preferences IndexedDB.'));
  });
}

export async function readPersistedThemePreference(): Promise<ThemePreference | null> {
  try {
    const db = await openPreferencesDb();
    if (!db) {
      return null;
    }
    try {
      return await new Promise<ThemePreference | null>((resolve, reject) => {
        const tx = db.transaction(PREF_STORE_NAME, 'readonly');
        const store = tx.objectStore(PREF_STORE_NAME);
        const req = store.get(PREF_RECORD_KEY);
        req.onsuccess = () => resolve(parseThemePreference(req.result));
        req.onerror = () => reject(req.error ?? new Error('Failed to read theme preference.'));
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(preference));
    } catch {
      // Ignore quota/storage restrictions.
    }
  }

  try {
    const db = await openPreferencesDb();
    if (!db) {
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(PREF_STORE_NAME, 'readwrite');
        const store = tx.objectStore(PREF_STORE_NAME);
        const req = store.put({ id: PREF_RECORD_KEY, ...preference });
        req.onerror = () => reject(req.error ?? new Error('Failed to save theme preference.'));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Preferences write transaction failed.'));
      });
    } finally {
      db.close();
    }
  } catch {
    // localStorage remains updated even if IndexedDB is unavailable.
  }
}

export async function clearThemePreference(): Promise<void> {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      // Ignore storage errors.
    }
  }

  try {
    const db = await openPreferencesDb();
    if (!db) {
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(PREF_STORE_NAME, 'readwrite');
        const store = tx.objectStore(PREF_STORE_NAME);
        const req = store.delete(PREF_RECORD_KEY);
        req.onerror = () => reject(req.error ?? new Error('Failed to delete theme preference.'));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Preferences delete transaction failed.'));
      });
    } finally {
      db.close();
    }
  } catch {
    // Ignore cleanup errors.
  }
}

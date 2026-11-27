import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  clearThemePreference,
  loadInitialThemePreference,
  readPersistedThemePreference,
  saveThemePreference,
} from './themeStorage';

describe('themeStorage', () => {
  afterEach(async () => {
    await clearThemePreference();
    vi.restoreAllMocks();
  });

  it('saves and restores theme and mode across localStorage and IndexedDB', async () => {
    await saveThemePreference({ theme: 'warm-hearthside', mode: 'dark' });

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(
      JSON.stringify({ theme: 'warm-hearthside', mode: 'dark' }),
    );
    expect(loadInitialThemePreference()).toEqual({
      theme: 'warm-hearthside',
      mode: 'dark',
    });

    // Clear localStorage only to verify IndexedDB fallback hydration survives restart/eviction.
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    expect(await readPersistedThemePreference()).toEqual({
      theme: 'warm-hearthside',
      mode: 'dark',
    });
  });

  it('falls back safely when localStorage contains malformed JSON', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, '{bad-json');
    expect(loadInitialThemePreference()).toEqual({
      theme: 'clean-minimal',
      mode: 'light',
    });
  });
});

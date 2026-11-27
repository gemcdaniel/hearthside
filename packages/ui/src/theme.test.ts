import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_MODE,
  DEFAULT_THEME_NAME,
  DEFAULT_THEME_PREFERENCE,
  applyThemeToDocument,
  isThemeMode,
  isThemeName,
} from './index';

describe('ui theme helpers', () => {
  it('defines starter theme and mode defaults', () => {
    expect(DEFAULT_THEME_NAME).toBe('clean-minimal');
    expect(DEFAULT_THEME_MODE).toBe('light');
    expect(DEFAULT_THEME_PREFERENCE).toEqual({
      theme: 'clean-minimal',
      mode: 'light',
    });
  });

  it('validates theme names and modes', () => {
    expect(isThemeName('clean-minimal')).toBe(true);
    expect(isThemeName('warm-hearthside')).toBe(true);
    expect(isThemeName('other')).toBe(false);

    expect(isThemeMode('light')).toBe(true);
    expect(isThemeMode('dark')).toBe(true);
    expect(isThemeMode('auto')).toBe(false);
  });

  it('applies data-theme and data-mode attributes to the document root', () => {
    const el = document.createElement('html');
    applyThemeToDocument({ theme: 'warm-hearthside', mode: 'dark' }, el);
    expect(el.dataset.theme).toBe('warm-hearthside');
    expect(el.dataset.mode).toBe('dark');
  });
});

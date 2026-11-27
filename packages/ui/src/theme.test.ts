import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_MODE,
  DEFAULT_THEME_NAME,
  DEFAULT_THEME_PREFERENCE,
  THEME_META_COLORS,
  applyThemeToDocument,
  getThemeMetaColor,
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

  it('applies data-theme, data-mode, and dynamic theme-color meta tags across all variants', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.append(meta);

    for (const theme of ['clean-minimal', 'warm-hearthside'] as const) {
      for (const mode of ['light', 'dark'] as const) {
        applyThemeToDocument({ theme, mode }, document.documentElement);
        expect(document.documentElement.dataset.theme).toBe(theme);
        expect(document.documentElement.dataset.mode).toBe(mode);
        expect(meta.getAttribute('content')).toBe(THEME_META_COLORS[theme][mode]);
        expect(getThemeMetaColor({ theme, mode })).toBe(THEME_META_COLORS[theme][mode]);
      }
    }

    meta.remove();
  });
});

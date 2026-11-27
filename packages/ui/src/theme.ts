export type ThemeMode = 'light' | 'dark';
export type ThemeName = 'clean-minimal' | 'warm-hearthside';

export interface ThemePreference {
  readonly theme: ThemeName;
  readonly mode: ThemeMode;
}

export interface ThemeOption {
  readonly id: ThemeName;
  readonly label: string;
}

export interface ModeOption {
  readonly id: ThemeMode;
  readonly label: string;
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  { id: 'clean-minimal', label: 'Clean Minimal' },
  { id: 'warm-hearthside', label: 'Warm Hearthside' },
];

export const MODE_OPTIONS: readonly ModeOption[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

export const DEFAULT_THEME_NAME: ThemeName = 'clean-minimal';
export const DEFAULT_THEME_MODE: ThemeMode = 'light';
export const DEFAULT_THEME_PREFERENCE: ThemePreference = {
  theme: DEFAULT_THEME_NAME,
  mode: DEFAULT_THEME_MODE,
};

/** Matching `--hs-bg` tokens for dynamic `<meta name="theme-color">` PWA title/status bar sync. */
export const THEME_META_COLORS: Readonly<Record<ThemeName, Readonly<Record<ThemeMode, string>>>> = {
  'clean-minimal': {
    light: '#f8fafc',
    dark: '#0b1120',
  },
  'warm-hearthside': {
    light: '#faf7f2',
    dark: '#1c1917',
  },
};

export function getThemeMetaColor(preference: ThemePreference): string {
  return THEME_META_COLORS[preference.theme][preference.mode];
}

export function isThemeName(value: unknown): value is ThemeName {
  return value === 'clean-minimal' || value === 'warm-hearthside';
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

export function getSystemThemeMode(): ThemeMode {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return DEFAULT_THEME_MODE;
}

export function applyThemeToDocument(
  preference: ThemePreference,
  root: HTMLElement | undefined = typeof document !== 'undefined'
    ? document.documentElement
    : undefined,
): void {
  if (!root) {
    return;
  }
  root.dataset.theme = preference.theme;
  root.dataset.mode = preference.mode;

  const doc = root.ownerDocument;
  const themeColor = getThemeMetaColor(preference);
  let meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta && doc.head) {
    meta = doc.createElement('meta');
    meta.name = 'theme-color';
    doc.head.append(meta);
  }
  if (meta) {
    meta.setAttribute('content', themeColor);
  }
}

export type ThemeId = 'clean-minimal' | 'warm-hearthside';
export type ColorMode = 'light' | 'dark';

export type AvatarId = 'hearth' | 'star' | 'leaf' | 'compass' | 'owl' | 'fox' | 'gem' | 'sun';

export const AVATAR_IDS: readonly AvatarId[] = [
  'hearth',
  'star',
  'leaf',
  'compass',
  'owl',
  'fox',
  'gem',
  'sun',
];

export type ProfileAccentId = 'cobalt' | 'terracotta' | 'forest' | 'plum' | 'amber' | 'teal';

export const PROFILE_ACCENT_IDS: readonly ProfileAccentId[] = [
  'cobalt',
  'terracotta',
  'forest',
  'plum',
  'amber',
  'teal',
];

export interface Profile {
  readonly id: string;
  readonly name: string;
  readonly avatarId: AvatarId;
  readonly accentColor: ProfileAccentId;
  readonly createdAt: string;
}

export interface SudokuProfileSettings {
  /** Highlight cells sharing the same digit in a row, column, or 3x3 box (D21, default ON). */
  readonly flagDuplicateConflicts: boolean;
  /** Highlight entries that disagree with the unique solution even without a peer duplicate (D21, default OFF). */
  readonly flagWrongValues: boolean;
}

export interface ProfileSettings {
  readonly theme: ThemeId;
  readonly mode: ColorMode;
  readonly sfxEnabled: boolean;
  readonly sfxVolume: number;
  readonly musicEnabled: boolean;
  readonly musicVolume: number;
  readonly sudoku: SudokuProfileSettings;
}

export const DEFAULT_SUDOKU_SETTINGS: SudokuProfileSettings = {
  flagDuplicateConflicts: true,
  flagWrongValues: false,
};

export function createDefaultProfileSettings(mode: ColorMode = 'light'): ProfileSettings {
  return {
    theme: 'clean-minimal',
    mode,
    sfxEnabled: true,
    sfxVolume: 0.7,
    musicEnabled: false,
    musicVolume: 0.4,
    sudoku: { ...DEFAULT_SUDOKU_SETTINGS },
  };
}

export function isThemeId(value: unknown): value is ThemeId {
  return value === 'clean-minimal' || value === 'warm-hearthside';
}

export function isColorMode(value: unknown): value is ColorMode {
  return value === 'light' || value === 'dark';
}

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === 'string' && (AVATAR_IDS as readonly string[]).includes(value);
}

export function isProfileAccentId(value: unknown): value is ProfileAccentId {
  return typeof value === 'string' && (PROFILE_ACCENT_IDS as readonly string[]).includes(value);
}

import { APP_DISPLAY_NAME } from '@hearthside/game-core';
import {
  DEFAULT_THEME_MODE,
  DEFAULT_THEME_NAME,
  type ThemeMode,
  type ThemeName,
} from '@hearthside/ui';

export interface AppInfo {
  readonly title: string;
  readonly themeName: ThemeName;
  readonly themeMode: ThemeMode;
}

export function getAppTitle(): string {
  return APP_DISPLAY_NAME;
}

export function getAppInfo(): AppInfo {
  return {
    title: APP_DISPLAY_NAME,
    themeName: DEFAULT_THEME_NAME,
    themeMode: DEFAULT_THEME_MODE,
  };
}

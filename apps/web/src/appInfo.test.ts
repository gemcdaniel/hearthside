import { describe, expect, it } from 'vitest';
import { getAppInfo, getAppTitle, getAppVersion } from './appInfo';

describe('web shell appInfo', () => {
  it('uses centralized Hearthside title and v1.0.0 version', () => {
    expect(getAppTitle()).toBe('Hearthside');
    expect(getAppVersion()).toBe('1.0.0');
    expect(getAppInfo()).toEqual({
      title: 'Hearthside',
      version: '1.0.0',
      themeName: 'clean-minimal',
      themeMode: 'light',
    });
  });
});

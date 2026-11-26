import { describe, expect, it } from 'vitest';
import { getAppInfo, getAppTitle } from './appInfo';

describe('web shell appInfo', () => {
  it('uses centralized Hearthside title', () => {
    expect(getAppTitle()).toBe('Hearthside');
    expect(getAppInfo()).toEqual({
      title: 'Hearthside',
      themeName: 'clean-minimal',
      themeMode: 'light',
    });
  });
});

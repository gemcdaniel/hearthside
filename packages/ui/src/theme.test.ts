import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME_MODE, DEFAULT_THEME_NAME } from './index';

describe('ui theme defaults', () => {
  it('defines starter theme and mode defaults', () => {
    expect(DEFAULT_THEME_NAME).toBe('clean-minimal');
    expect(DEFAULT_THEME_MODE).toBe('light');
  });
});

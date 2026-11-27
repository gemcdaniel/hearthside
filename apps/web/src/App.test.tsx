import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { clearThemePreference } from './storage/themeStorage';

describe('App theme and mode switching', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
      }),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await clearThemePreference();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.mode;
  });

  it('switches themes and light/dark modes live on documentElement and persists across remount', async () => {
    const firstRender = render(<App />);

    expect(document.documentElement.dataset.theme).toBe('clean-minimal');
    expect(document.documentElement.dataset.mode).toBe('light');

    fireEvent.click(screen.getByRole('button', { name: 'Warm Hearthside' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('warm-hearthside');
      expect(document.documentElement.dataset.mode).toBe('dark');
    });

    firstRender.unmount();

    render(<App />);
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('warm-hearthside');
      expect(document.documentElement.dataset.mode).toBe('dark');
    });
    expect(screen.getByRole('button', { name: 'Warm Hearthside' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  });
});

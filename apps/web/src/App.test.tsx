import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { audioService } from './audio/audioService';
import { resetHearthsideDbForTests } from './storage/hearthsideDb';
import { clearThemePreference } from './storage/themeStorage';

describe('Hearthside AIO Shell', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
      }),
    );
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    audioService.resetForTests();
    await resetHearthsideDbForTests();
    await clearThemePreference();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.mode;
  });

  it('renders the Library with seeded Player 1 and launches Sudoku through the plugin registry', async () => {
    render(<App />);

    expect(await screen.findByText('Welcome, Player 1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sudoku' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New Game' }));

    expect(await screen.findByRole('button', { name: 'Back to Library' })).toBeInTheDocument();
    expect(
      screen.getByRole('grid', { name: '9 by 9 Sudoku placeholder grid' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to Library' }));
    expect(await screen.findByText('Welcome, Player 1')).toBeInTheDocument();
  });

  it('switches themes and light/dark modes live on documentElement and persists across remount', async () => {
    const firstRender = render(<App />);

    await screen.findByText('Welcome, Player 1');
    expect(document.documentElement.dataset.theme).toBe('clean-minimal');
    expect(document.documentElement.dataset.mode).toBe('light');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = await screen.findByRole('dialog', { name: /Settings/ });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Warm Hearthside' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dark' }));

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

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const remountDialog = await screen.findByRole('dialog', { name: /Settings/ });
    expect(within(remountDialog).getByRole('button', { name: 'Warm Hearthside' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(remountDialog).getByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('isolates theme, mode, and Sudoku D21 toggles per local profile across quick switching', async () => {
    render(<App />);
    await screen.findByText('Welcome, Player 1');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = await screen.findByRole('dialog', { name: /Settings/ });

    // Create a second profile ("Alex")
    fireEvent.change(within(dialog).getByLabelText('New profile name'), {
      target: { value: 'Alex' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add Profile' }));

    await screen.findByText('Welcome, Alex');

    // Customize Alex's theme, mode, and kid-friendly wrong-value toggle
    fireEvent.click(within(dialog).getByRole('button', { name: 'Warm Hearthside' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dark' }));

    const wrongToggle = within(dialog).getByLabelText('Flag wrong values live (kid-friendly)');
    expect(wrongToggle).not.toBeChecked();
    fireEvent.click(wrongToggle);
    expect(wrongToggle).toBeChecked();

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('warm-hearthside');
      expect(document.documentElement.dataset.mode).toBe('dark');
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Settings' }));

    // Quick switch back to Player 1 via header dropdown
    const profileTrigger = await screen.findByRole('button', { name: /Active profile: Alex/ });
    fireEvent.click(profileTrigger);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Player 1/ }));

    await screen.findByText('Welcome, Player 1');
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('clean-minimal');
      expect(document.documentElement.dataset.mode).toBe('light');
    });

    // Confirm Player 1 still has D21 default (wrong values OFF)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const p1Dialog = await screen.findByRole('dialog', { name: /Settings/ });
    expect(
      within(p1Dialog).getByLabelText('Flag duplicate conflicts in row, column, or box'),
    ).toBeChecked();
    expect(
      within(p1Dialog).getByLabelText('Flag wrong values live (kid-friendly)'),
    ).not.toBeChecked();
  });
});

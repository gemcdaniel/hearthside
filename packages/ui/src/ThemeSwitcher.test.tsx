import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeSwitcher } from './ThemeSwitcher';

describe('ThemeSwitcher', () => {
  it('marks the active theme and mode and invokes change callbacks', () => {
    const onThemeChange = vi.fn();
    const onModeChange = vi.fn();

    render(
      <ThemeSwitcher
        theme="clean-minimal"
        mode="light"
        onThemeChange={onThemeChange}
        onModeChange={onModeChange}
      />,
    );

    expect(screen.getByRole('button', { name: 'Clean Minimal' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Warm Hearthside' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Warm Hearthside' }));
    expect(onThemeChange).toHaveBeenCalledWith('warm-hearthside');

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
    expect(onModeChange).toHaveBeenCalledWith('dark');
  });
});

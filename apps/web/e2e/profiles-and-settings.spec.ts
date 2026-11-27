import { expect, test } from '@playwright/test';

test.describe('Local Profiles & Isolated Settings', () => {
  test('creates profiles, switches quick-switcher, and persists isolated theme and D21 settings across reload', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome, Player 1')).toBeVisible();

    // Open Settings and create a second local profile ("Maya")
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: /Settings/ });
    await dialog.getByLabel('New profile name').fill('Maya');
    await dialog.getByRole('button', { name: 'Add Profile' }).click();

    await expect(page.getByText('Welcome, Maya')).toBeVisible();

    // Configure Maya with Warm Hearthside + Dark + Kid-friendly wrong-value flagging ON
    await dialog.getByRole('button', { name: 'Warm Hearthside' }).click();
    await dialog.getByRole('button', { name: 'Dark' }).click();
    const wrongToggle = dialog.getByLabel('Flag wrong values live (kid-friendly)');
    await wrongToggle.check();
    await expect(wrongToggle).toBeChecked();

    // Background Music & volume controls are enabled and isolated per profile
    const musicToggle = dialog.getByLabel('Background music');
    await expect(musicToggle).toBeEnabled();
    await expect(dialog.getByLabel(/Music volume/)).toBeEnabled();
    await expect(dialog.getByText('Coming in Phase 3')).toBeHidden();
    await musicToggle.check();
    await expect(musicToggle).toBeChecked();

    await dialog.getByRole('button', { name: 'Close Settings' }).click();

    // Reload and verify Maya's theme + mode + D21 setting persisted cleanly
    await page.reload();
    await expect(page.getByText('Welcome, Maya')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'warm-hearthside');
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');

    // Quick-switch back to Player 1 via shell header menu
    await page.getByRole('button', { name: /Active profile: Maya/ }).click();
    await page.getByRole('menuitemradio', { name: /Player 1/ }).click();

    await expect(page.getByText('Welcome, Player 1')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'clean-minimal');
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByLabel('Flag wrong values live (kid-friendly)')).not.toBeChecked();
    await expect(page.getByLabel('Background music')).not.toBeChecked();
  });
});

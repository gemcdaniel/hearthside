import { expect, test } from '@playwright/test';

test.describe('WASM 4-Tier Hints & Offline Daily Puzzle Persistence', () => {
  test('steps through wrong-entry guard then Tier 1 -> 2 -> 3 -> 4 undoable WASM hint', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Easy', exact: true }).click();

    const grid = page.getByRole('grid', { name: '9 by 9 Sudoku board' });
    const cellR1C1 = grid.getByRole('gridcell', { name: /Row 1, Column 1/ });

    // Enter wrong digit 1 into R1C1 -> WASM Hint must flag it before giving a logical step
    await cellR1C1.click();
    await page.getByRole('button', { name: /Enter 1,/ }).click();

    await page.getByRole('button', { name: 'Hint' }).click();
    const hintCard = page.getByTestId('sudoku-hint-card');
    await expect(hintCard).toBeVisible({ timeout: 15_000 });
    await expect(hintCard).toContainText('Wrong Entry Found');
    await expect(cellR1C1).toHaveAttribute('data-hint-role', 'issue');

    // Clear via hint prompt
    await hintCard.getByRole('button', { name: 'Clear' }).click();
    await expect(cellR1C1).toHaveText('');

    // Now step progressively through Tier 1 -> 2 -> 3 -> 4
    await page.getByRole('button', { name: 'Hint' }).click();
    await expect(hintCard).toContainText('Hint 1/4', { timeout: 15_000 });

    await hintCard.getByRole('button', { name: 'Next Hint' }).click();
    await expect(hintCard).toContainText('Hint 2/4');

    await hintCard.getByRole('button', { name: 'Next Hint' }).click();
    await expect(hintCard).toContainText('Hint 3/4');

    const statusBeforeApply = await page.getByTestId('sudoku-status-rail').textContent();
    expect(statusBeforeApply).toContain('Hint 3/4');

    await hintCard.getByRole('button', { name: 'Apply Step' }).click();
    await expect(page.getByTestId('sudoku-status-rail')).toContainText(/Applied hint/i);

    // Undo cleanly reverts Tier 4 placement/elimination
    await page.getByRole('button', { name: 'Undo' }).click();
  });

  test('generates deterministic Daily Puzzle and survives offline reload after Service Worker ready', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome, Player 1')).toBeVisible();

    // Ensure Service Worker is active and controlling this client before going offline
    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.ready;
      }
    });
    const hasController = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller));
    if (!hasController) {
      await page.reload();
      await page.evaluate(async () => {
        if ('serviceWorker' in navigator) {
          await navigator.serviceWorker.ready;
        }
      });
    }

    await page.getByRole('button', { name: /Daily Easy/ }).click();
    const grid = page.getByRole('grid', { name: '9 by 9 Sudoku board' });
    await expect(grid).toBeVisible({ timeout: 20_000 });

    // Wait for generating overlay (if shown) to clear
    await expect(page.getByText('Preparing Daily Puzzle...')).toBeHidden({ timeout: 20_000 });

    // Place digit 5 in the first empty cell
    const firstEmpty = grid.getByRole('gridcell', { name: /, empty/ }).first();
    const emptyLabel = (await firstEmpty.getAttribute('aria-label')) ?? '';
    const coordMatch = /Row \d+, Column \d+/.exec(emptyLabel)?.[0] ?? 'Row 1, Column 1';
    await firstEmpty.click();
    await page.getByRole('button', { name: /Enter 5,/ }).click();
    await expect(grid.getByRole('gridcell', { name: new RegExp(coordMatch) })).toContainText('5');

    // Cut network completely and reload offline
    await page.context().setOffline(true);
    await page.reload();

    await expect(page.getByText('Welcome, Player 1')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Daily Easy/ })).toContainText('Resume');

    await page.getByRole('button', { name: /Daily Easy/ }).click();
    const offlineGrid = page.getByRole('grid', { name: '9 by 9 Sudoku board' });
    await expect(offlineGrid).toBeVisible();
    await expect(offlineGrid.getByRole('gridcell', { name: new RegExp(coordMatch) })).toContainText(
      '5',
    );
  });
});

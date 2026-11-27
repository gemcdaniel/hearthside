import { expect, test } from '@playwright/test';

test.describe('Sudoku Gameplay, D8/D12/D20 Notes, D21 Mistakes & Pause Curtain', () => {
  test('enforces D8 peer hiding + undo restoration, D12/D20 auto-show, D21 split toggles, and pause curtain', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome, Player 1')).toBeVisible();

    await page.getByRole('button', { name: 'Easy', exact: true }).click();
    const grid = page.getByRole('grid', { name: '9 by 9 Sudoku board' });
    await expect(grid).toBeVisible();

    const cellR1C1 = grid.getByRole('gridcell', { name: /Row 1, Column 1/ });
    const cellR1C2 = grid.getByRole('gridcell', { name: /Row 1, Column 2/ });
    const cellR1C6 = grid.getByRole('gridcell', { name: /Row 1, Column 6/ });

    // Enter manual notes 1 and 4 in R1C1 (Notes mode)
    await cellR1C1.click();
    await page.getByRole('button', { name: 'Notes' }).click();
    await page.getByRole('button', { name: /Note 1,/ }).click();
    await page.getByRole('button', { name: /Note 4,/ }).click();
    await expect(cellR1C1.locator('[data-note-digit="1"]')).toHaveAttribute('data-active', 'true');
    await expect(cellR1C1.locator('[data-note-digit="4"]')).toHaveAttribute('data-active', 'true');

    // D8: place digit 4 in peer R1C2 -> hides note 4 in R1C1 without deleting; Undo restores it
    await page.getByRole('button', { name: 'Notes' }).click();
    await cellR1C2.click();
    await page.getByRole('button', { name: /Enter 4,/ }).click();
    await expect(cellR1C1.locator('[data-note-digit="4"]')).toHaveAttribute('data-active', 'false');
    await expect(cellR1C1.locator('[data-note-digit="1"]')).toHaveAttribute('data-active', 'true');

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(cellR1C1.locator('[data-note-digit="4"]')).toHaveAttribute('data-active', 'true');

    // D12/D20: toggle Auto-Show ON -> legal candidate 7 appears; toggle 7 off in Auto-Show,
    // then toggle Auto-Show OFF -> overlay discards cleanly while manual notes 1 & 4 stay
    await page.getByRole('button', { name: 'Auto-Show' }).click();
    await expect(cellR1C1.locator('[data-note-digit="7"]')).toHaveAttribute('data-active', 'true');
    await cellR1C1.click();
    await page.getByRole('button', { name: 'Notes' }).click();
    await page.getByRole('button', { name: /Note 7,/ }).click();
    await expect(cellR1C1.locator('[data-note-digit="7"]')).toHaveAttribute('data-active', 'false');
    await page.getByRole('button', { name: 'Notes' }).click();

    await page.getByRole('button', { name: 'Auto-Show' }).click();
    await expect(cellR1C1.locator('[data-note-digit="7"]')).toHaveAttribute('data-active', 'false');
    await expect(cellR1C1.locator('[data-note-digit="1"]')).toHaveAttribute('data-active', 'true');
    await expect(cellR1C1.locator('[data-note-digit="4"]')).toHaveAttribute('data-active', 'true');

    // D21: place duplicate 8 in R1C1 (R1C6 has given 8) -> conflict highlight
    await cellR1C1.click();
    await page.getByRole('button', { name: /Enter 8,/ }).click();
    await expect(cellR1C1).toHaveAttribute('data-conflict', 'true');
    await expect(cellR1C6).toHaveAttribute('data-conflict', 'true');

    // Replace with non-conflicting wrong digit 1 (flagWrongValues=false) -> Check Board flags it
    await page.getByRole('button', { name: /Enter 1,/ }).click();
    await expect(cellR1C1).toHaveAttribute('data-conflict', 'false');
    await expect(cellR1C1).toHaveAttribute('data-wrong', 'false');
    await page.getByRole('button', { name: 'Check Board' }).click();
    await expect(cellR1C1).toHaveAttribute('data-wrong', 'true');
    await expect(page.getByTestId('sudoku-status-rail')).toContainText('1 wrong entry highlighted');

    // Pause curtain conceals board digits and notes until Resume
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByTestId('pause-curtain')).toBeVisible();
    await expect(cellR1C6).toHaveText('');
    await page.getByRole('button', { name: 'Resume Game' }).click();
    await expect(page.getByTestId('pause-curtain')).toBeHidden();
    await expect(cellR1C6).toContainText('8');
  });
});

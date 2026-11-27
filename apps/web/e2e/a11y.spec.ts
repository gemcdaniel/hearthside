import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const THEME_MODES = [
  { themeLabel: 'Clean Minimal', modeLabel: 'Light', themeId: 'clean-minimal', modeId: 'light' },
  { themeLabel: 'Clean Minimal', modeLabel: 'Dark', themeId: 'clean-minimal', modeId: 'dark' },
  {
    themeLabel: 'Warm Hearthside',
    modeLabel: 'Light',
    themeId: 'warm-hearthside',
    modeId: 'light',
  },
  {
    themeLabel: 'Warm Hearthside',
    modeLabel: 'Dark',
    themeId: 'warm-hearthside',
    modeId: 'dark',
  },
] as const;

async function expectNoCriticalOrSeriousViolations(page: Page, contextLabel: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const severe = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  const formatted = severe
    .map(
      (v) =>
        `[${v.impact ?? 'unknown'}] ${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
    )
    .join('\n');

  expect(severe, `${contextLabel} axe violations:\n${formatted}`).toEqual([]);
}

test.describe('WCAG 2.1 AA Accessibility Audit & Keyboard/Focus Management', () => {
  for (const variant of THEME_MODES) {
    test(`passes WCAG 2.1 AA across all views and modals in ${variant.themeLabel} (${variant.modeLabel})`, async ({
      page,
    }) => {
      await page.goto('/');
      await expect(page.getByText('Welcome, Player 1')).toBeVisible();

      // Switch to target theme & mode inside Settings
      await page.getByRole('button', { name: 'Settings' }).click();
      const settingsDialog = page.getByRole('dialog', { name: /Settings/ });
      await expect(settingsDialog).toBeVisible();
      await settingsDialog.getByRole('button', { name: variant.themeLabel }).click();
      await settingsDialog.getByRole('button', { name: variant.modeLabel }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', variant.themeId);
      await expect(page.locator('html')).toHaveAttribute('data-mode', variant.modeId);

      // 1. Audit Settings modal
      await expectNoCriticalOrSeriousViolations(
        page,
        `Settings modal (${variant.themeId}/${variant.modeId})`,
      );
      await page.keyboard.press('Escape');
      await expect(settingsDialog).toBeHidden();

      // 2. Audit Library home screen
      await expectNoCriticalOrSeriousViolations(
        page,
        `Library view (${variant.themeId}/${variant.modeId})`,
      );

      // 3. Audit Profile Switcher dialog
      await page.getByRole('button', { name: /Active profile:/ }).click();
      const switcherDialog = page.getByRole('dialog', { name: 'Switch profile' });
      await expect(switcherDialog).toBeVisible();
      await expectNoCriticalOrSeriousViolations(
        page,
        `Profile Switcher (${variant.themeId}/${variant.modeId})`,
      );
      await page.keyboard.press('Escape');
      await expect(switcherDialog).toBeHidden();

      // 4. Audit Stats modal
      await page.getByRole('button', { name: 'View Stats' }).click();
      const statsDialog = page.getByRole('dialog', { name: 'Sudoku Statistics' });
      await expect(statsDialog).toBeVisible();
      await expectNoCriticalOrSeriousViolations(
        page,
        `Stats modal (${variant.themeId}/${variant.modeId})`,
      );
      await page.keyboard.press('Escape');
      await expect(statsDialog).toBeHidden();

      // 5. Launch Easy Sudoku and exercise notes, Auto-Show, conflict, and Hint highlight
      await page.getByRole('button', { name: 'Easy', exact: true }).click();
      const grid = page.getByRole('grid', { name: '9 by 9 Sudoku board' });
      await expect(grid).toBeVisible();

      const emptyCells = grid.getByRole('gridcell', { name: /, empty/ });
      const secondEmpty = emptyCells.nth(1);
      await secondEmpty.click();
      await page.getByRole('button', { name: 'Notes' }).click();
      await page.getByRole('button', { name: /Note 2,/ }).click();
      await page.getByRole('button', { name: 'Notes' }).click();

      // Enable Auto-Show
      await page.getByRole('button', { name: 'Auto-Show' }).click();

      // Create duplicate conflict in R1C1 (row 0 already has 8 in R1C6) and request Hint
      const cellR1C1 = grid.getByRole('gridcell', { name: /Row 1, Column 1/ });
      await cellR1C1.click();
      await page.getByRole('button', { name: /Enter 8,/ }).click();
      await expect(cellR1C1).toHaveAttribute('data-conflict', 'true');

      await page.getByRole('button', { name: 'Hint' }).click();
      await expect(page.getByTestId('sudoku-hint-card')).toBeVisible({ timeout: 15_000 });

      await expectNoCriticalOrSeriousViolations(
        page,
        `Active Sudoku board (${variant.themeId}/${variant.modeId})`,
      );

      // 6. Advance the saved puzzle to 1 empty cell remaining via IndexedDB and audit Victory modal
      const lastDigit = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('hearthside-db');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        try {
          const tx = db.transaction('saves', 'readwrite');
          const store = tx.objectStore('saves');
          const allRecords = await new Promise<
            Array<{
              profileId: string;
              gameId: string;
              slot: string;
              payload: string;
              [key: string]: unknown;
            }>
          >((resolve, reject) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const easySave = allRecords.find((r) => r.gameId === 'sudoku' && r.slot === 'easy');
          if (!easySave) {
            throw new Error('Expected active easy save in IndexedDB');
          }
          const parsed = JSON.parse(easySave.payload) as {
            schemaVersion: number;
            state: {
              puzzle: { solution: string };
              cells: Array<{ value: number }>;
              completed: boolean;
            };
          };
          const solution = parsed.state.puzzle.solution;
          for (let i = 0; i < 81; i += 1) {
            parsed.state.cells[i]!.value = i === 0 ? 0 : Number(solution.charAt(i));
          }
          parsed.state.completed = false;
          easySave.payload = JSON.stringify(parsed);
          store.put(easySave);
          await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          return Number(solution.charAt(0));
        } finally {
          db.close();
        }
      });

      await page.reload();
      await page.getByRole('button', { name: /^Easy/ }).click();
      const resumedGrid = page.getByRole('grid', { name: '9 by 9 Sudoku board' });
      const resumedR1C1 = resumedGrid.getByRole('gridcell', { name: /Row 1, Column 1/ });
      await resumedR1C1.click();
      await page.getByRole('button', { name: new RegExp(`Enter ${lastDigit},`) }).click();

      const victoryDialog = page.getByRole('dialog', { name: /Puzzle Solved/i });
      await expect(victoryDialog).toBeVisible();
      await expectNoCriticalOrSeriousViolations(
        page,
        `Victory modal (${variant.themeId}/${variant.modeId})`,
      );
    });
  }

  test('supports keyboard-only gameplay, roving grid focus, and modal focus trapping/restoration', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome, Player 1')).toBeVisible();

    // Launch Easy Sudoku via keyboard Enter
    const easyBtn = page.getByRole('button', { name: 'Easy', exact: true });
    await easyBtn.focus();
    await page.keyboard.press('Enter');

    const grid = page.getByRole('grid', { name: '9 by 9 Sudoku board' });
    await expect(grid).toBeVisible();

    // Focus first grid cell and verify ArrowRight moves activeElement to Column 2, ArrowLeft returns to Column 1
    const r1c1 = grid.getByRole('gridcell', { name: /Row 1, Column 1/ });
    const r1c2 = grid.getByRole('gridcell', { name: /Row 1, Column 2/ });
    await r1c1.focus();
    await page.keyboard.press('ArrowRight');
    await expect(r1c2).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(r1c1).toBeFocused();

    // Toggle Notes ON ('n'), enter note 4, verify cell aria-label communicates notes
    await page.keyboard.press('n');
    await expect(page.getByRole('button', { name: 'Notes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('4');
    await expect(r1c1).toHaveAttribute('aria-label', /notes.*4/);

    // Toggle Notes OFF ('n'), toggle Auto-Show ('a'), trigger Hint ('h')
    await page.keyboard.press('n');
    await page.keyboard.press('a');
    await expect(page.getByRole('button', { name: 'Auto-Show' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('h');
    await expect(page.getByTestId('sudoku-hint-card')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('sudoku-live-announcer')).toContainText(/Hint 1\/4/);

    // Pause ('p') moves focus to Resume Game; Enter resumes cleanly
    await page.keyboard.press('p');
    const resumeBtn = page.getByRole('button', { name: 'Resume Game' });
    await expect(resumeBtn).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pause-curtain')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();

    // Place a digit so New Puzzle triggers confirmation, verify focus trap & Escape restores focus
    await r1c1.focus();
    await page.keyboard.press('1');
    const newPuzzleBtn = page.getByRole('button', { name: 'New Puzzle' });
    await newPuzzleBtn.focus();
    await page.keyboard.press('Enter');
    const confirmDialog = page.getByRole('dialog', { name: 'New Puzzle?' });
    await expect(confirmDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirmDialog).toBeHidden();
    await expect(newPuzzleBtn).toBeFocused();

    // Settings modal traps Tab strictly inside dialog and restores focus to Settings button on Escape
    const settingsBtn = page.getByRole('button', { name: 'Settings' });
    await settingsBtn.click();
    const settingsDialog = page.getByRole('dialog', { name: /Settings/ });
    await expect(settingsDialog).toBeVisible();

    for (let i = 0; i < 16; i += 1) {
      await page.keyboard.press('Tab');
      const insideDialog = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
        return Boolean(dialog && document.activeElement && dialog.contains(document.activeElement));
      });
      expect(insideDialog).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(settingsDialog).toBeHidden();
    await expect(settingsBtn).toBeFocused();
  });
});

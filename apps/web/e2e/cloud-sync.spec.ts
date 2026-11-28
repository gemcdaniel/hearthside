import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, '../../..');
const WEB_DIST_DIR = path.resolve(REPO_ROOT, 'apps/web/dist');

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close(() => reject(new Error('Failed to allocate ephemeral port')));
        return;
      }
      const { port } = addr;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/healthz`);
      if (res.ok) {
        return;
      }
    } catch {
      // Server still booting.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for Go server healthz at ${baseUrl}`);
}

async function expectNoSevereAxeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const severe = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  const summary = severe
    .map(
      (v) =>
        `[${v.impact ?? 'unknown'}] ${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
    )
    .join('\n');
  expect(severe, `${label} axe violations:\n${summary}`).toEqual([]);
}

async function ensureServiceWorkerReady(page: Page): Promise<void> {
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
}

async function syncViaSettings(
  page: Page,
  expectedBadge: 'Synced' | 'Sync conflict' = 'Synced',
): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  const settingsDialog = page.getByRole('dialog', { name: /Settings/ });
  await expect(settingsDialog).toBeVisible();
  const syncCard = settingsDialog.getByRole('region', { name: 'Cloud Sync Status' });
  await syncCard.getByRole('button', { name: 'Sync Now' }).click();
  await expect(syncCard.getByText(expectedBadge, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(syncCard.getByRole('button', { name: 'Sync Now' })).toBeEnabled({ timeout: 15_000 });
  await settingsDialog.getByRole('button', { name: 'Close Settings' }).click();
  await expect(settingsDialog).toBeHidden();
}

interface EmptyCellStep {
  readonly index: number;
  readonly row: number;
  readonly col: number;
  readonly digit: string;
}

async function readActiveSaveStepsFromIdb(
  page: Page,
  targetSlot: string,
): Promise<EmptyCellStep[] | null> {
  return page.evaluate(async (slotKey) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('hearthside-db');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const saves = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const tx = db.transaction('saves', 'readonly');
        const req = tx.objectStore('saves').getAll();
        req.onsuccess = () => resolve(req.result as Array<Record<string, unknown>>);
        req.onerror = () => reject(req.error);
      });
      const match = saves.find((s) => s.slot === slotKey && s.deleted !== true);
      if (!match || typeof match.payload !== 'string') {
        return null;
      }
      const parsed = JSON.parse(match.payload) as {
        state: {
          completed?: boolean;
          puzzle: { solution: string };
          cells: Array<{ value: number; given: boolean }>;
        };
      };
      if (parsed.state.completed) {
        return null;
      }
      const steps: EmptyCellStep[] = [];
      for (let idx = 0; idx < parsed.state.cells.length; idx += 1) {
        const cell = parsed.state.cells[idx];
        const digit = parsed.state.puzzle.solution[idx];
        if (cell && !cell.given && cell.value === 0 && digit) {
          steps.push({
            index: idx,
            row: Math.floor(idx / 9) + 1,
            col: (idx % 9) + 1,
            digit,
          });
        }
      }
      return steps;
    } finally {
      db.close();
    }
  }, targetSlot);
}

async function readRemainingCellsForSlot(page: Page, slot: string): Promise<EmptyCellStep[]> {
  let steps = await readActiveSaveStepsFromIdb(page, slot);
  if (!steps) {
    const pauseBtn = page.getByRole('button', { name: 'Pause', exact: true });
    await expect(pauseBtn).toBeEnabled({ timeout: 15_000 });
    await pauseBtn.click();
    await expect(page.getByTestId('pause-curtain')).toBeVisible();
    await expect
      .poll(
        async () => {
          steps = await readActiveSaveStepsFromIdb(page, slot);
          return steps !== null;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    await page.getByRole('button', { name: 'Resume Game' }).click();
    await expect(page.getByTestId('pause-curtain')).toBeHidden();
    await expect(page.getByRole('grid', { name: '9 by 9 Sudoku board' })).toBeVisible();
  }
  if (!steps) {
    throw new Error(`Active save not found in IndexedDB for slot "${slot}"`);
  }
  return steps;
}

async function solveActiveBoardFromIndexedDb(page: Page, slot: string): Promise<void> {
  const steps = await readRemainingCellsForSlot(page, slot);
  const grid = page.getByRole('grid', { name: '9 by 9 Sudoku board' });
  await expect(grid).toBeVisible();
  const notesBtn = page.getByRole('button', { name: 'Notes' });
  if ((await notesBtn.getAttribute('aria-pressed')) === 'true') {
    await notesBtn.click();
    await expect(notesBtn).toHaveAttribute('aria-pressed', 'false');
  }
  for (const step of steps) {
    await grid
      .getByRole('gridcell', { name: new RegExp(`Row ${step.row}, Column ${step.col}`) })
      .click();
    await page.keyboard.press(step.digit);
  }
  await expect(page.getByRole('dialog', { name: /Puzzle Solved!/ })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('Phase 5 Two-Device Cloud Save & Stats Sync E2E', () => {
  test.describe.configure({ mode: 'serial' });

  let tmpDir = '';
  let serverProc: ChildProcess | null = null;
  let serverOrigin = '';

  test.beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearthside-sync-e2e-'));
    const binaryPath = path.join(tmpDir, 'hearthside-server');
    const goEnv = {
      ...process.env,
      PATH: `${process.env.PATH ?? ''}:/usr/local/go/bin:${os.homedir()}/go/bin`,
    };

    execFileSync('go', ['build', '-o', binaryPath, './services/api/cmd/server'], {
      cwd: REPO_ROOT,
      env: goEnv,
      stdio: 'inherit',
    });

    const port = await getFreePort();
    serverOrigin = `http://127.0.0.1:${port}`;
    const dbPath = path.join(tmpDir, 'sync-e2e.db');

    serverProc = spawn(binaryPath, [], {
      cwd: REPO_ROOT,
      env: {
        ...goEnv,
        HEARTHSIDE_ADDR: `127.0.0.1:${port}`,
        HEARTHSIDE_DB_PATH: dbPath,
        HEARTHSIDE_WEB_DIR: WEB_DIST_DIR,
        HEARTHSIDE_PUBLIC_BASE_URL: serverOrigin,
        HEARTHSIDE_COOKIE_SECURE: 'false',
        HEARTHSIDE_LOG_LEVEL: 'warn',
        HEARTHSIDE_PUZZLE_SCHEDULER_ENABLED: 'false',
      },
      stdio: 'pipe',
    });

    await waitForHealth(serverOrigin);
  });

  test.afterAll(async () => {
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          serverProc?.kill('SIGKILL');
          resolve();
        }, 3000);
        serverProc?.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('syncs across laptop and tablet: cross-device resume, conflict modal, lossless offline stats, split preferences, and a11y', async ({
    browser,
  }) => {
    test.setTimeout(120_000);

    const laptopContext: BrowserContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const tabletContext: BrowserContext = await browser.newContext({
      viewport: { width: 820, height: 1180 },
    });

    const laptopPage = await laptopContext.newPage();
    const tabletPage = await tabletContext.newPage();

    const pageErrors: string[] = [];
    const onlineConsoleErrors: string[] = [];
    let allowOfflineNetworkErrors = false;

    for (const p of [laptopPage, tabletPage]) {
      p.on('pageerror', (err) => pageErrors.push(err.message));
      p.on('console', (msg) => {
        if (msg.type() === 'error' && !allowOfflineNetworkErrors) {
          onlineConsoleErrors.push(msg.text());
        }
      });
    }

    try {
      // 1. Setup Laptop & Tablet + ensure SW caches offline assets cleanly
      await laptopPage.goto(serverOrigin);
      await ensureServiceWorkerReady(laptopPage);
      await laptopPage.getByRole('button', { name: 'Settings' }).click();
      const laptopSettings = laptopPage.getByRole('dialog', { name: /Settings/ });
      const bootForm = laptopSettings.getByRole('form', { name: 'Set Up Household' });
      await bootForm.getByLabel('Household name').fill('Oakwood Sync Home');
      await bootForm.getByLabel('Your display name').fill('Alex');
      await bootForm.getByLabel('Email address').fill('alex@example.com');
      await bootForm.getByLabel('Password (min 10 characters)').fill('oakwood-pass-123');
      await bootForm.getByRole('button', { name: 'Set Up Household' }).click();
      await expect(laptopSettings.getByText('Oakwood Sync Home')).toBeVisible();

      await laptopSettings.getByRole('button', { name: 'Link Local' }).click();
      await expect(laptopSettings.getByRole('region', { name: 'Cloud Sync Status' })).toBeVisible();
      await laptopSettings.getByRole('button', { name: 'Close Settings' }).click();

      // Laptop starts Easy puzzle, places one solved digit + one manual note, exits and syncs
      await laptopPage.getByRole('button', { name: 'Easy', exact: true }).click();
      await expect(laptopPage.getByRole('grid', { name: '9 by 9 Sudoku board' })).toBeVisible();
      const easySteps = await readRemainingCellsForSlot(laptopPage, 'easy');
      const placedStep = easySteps[0]!;
      const noteStep = easySteps[1]!;

      const laptopGrid = laptopPage.getByRole('grid', { name: '9 by 9 Sudoku board' });
      await laptopGrid
        .getByRole('gridcell', {
          name: new RegExp(`Row ${placedStep.row}, Column ${placedStep.col}`),
        })
        .click();
      await laptopPage.keyboard.press(placedStep.digit);

      await laptopPage.getByRole('button', { name: 'Notes' }).click();
      await laptopGrid
        .getByRole('gridcell', {
          name: new RegExp(`Row ${noteStep.row}, Column ${noteStep.col}`),
        })
        .click();
      await laptopPage.getByRole('button', { name: new RegExp(`Note ${noteStep.digit},`) }).click();
      await expect(
        laptopGrid.getByRole('gridcell', {
          name: new RegExp(`Row ${noteStep.row}, Column ${noteStep.col}`),
        }),
      ).toHaveAttribute('aria-label', new RegExp(`notes ${noteStep.digit}`));

      await laptopPage.getByRole('button', { name: 'Back to Library' }).click();
      await syncViaSettings(laptopPage, 'Synced');

      // Tablet signs in and adds Alex -> sees Easy Resume -> opens & finishes puzzle
      await tabletPage.goto(serverOrigin);
      await ensureServiceWorkerReady(tabletPage);
      await tabletPage.getByRole('button', { name: 'Settings' }).click();
      const tabletSettings = tabletPage.getByRole('dialog', { name: /Settings/ });
      const loginForm = tabletSettings.getByRole('form', { name: 'Sign In' });
      await loginForm.getByLabel('Email address').fill('alex@example.com');
      await loginForm.getByLabel('Password').fill('oakwood-pass-123');
      await loginForm.getByRole('button', { name: 'Sign In' }).click();
      await expect(tabletSettings.getByText('Oakwood Sync Home')).toBeVisible();

      await tabletSettings.getByRole('button', { name: 'Add to Device' }).first().click();
      await expect(tabletSettings.getByRole('region', { name: 'Cloud Sync Status' })).toBeVisible();
      await tabletSettings.getByRole('button', { name: 'Close Settings' }).click();

      await expect(tabletPage.getByRole('button', { name: /Easy Resume/ })).toBeVisible({
        timeout: 15_000,
      });
      await tabletPage.getByRole('button', { name: /Easy Resume/ }).click();

      const tabletGrid = tabletPage.getByRole('grid', { name: '9 by 9 Sudoku board' });
      await expect(
        tabletGrid.getByRole('gridcell', {
          name: new RegExp(`Row ${placedStep.row}, Column ${placedStep.col}`),
        }),
      ).toHaveAttribute('aria-label', new RegExp(placedStep.digit));
      await expect(
        tabletGrid.getByRole('gridcell', {
          name: new RegExp(`Row ${noteStep.row}, Column ${noteStep.col}`),
        }),
      ).toHaveAttribute('aria-label', new RegExp(`notes ${noteStep.digit}`));

      await solveActiveBoardFromIndexedDb(tabletPage, 'easy');
      await tabletPage
        .getByRole('dialog', { name: /Puzzle Solved!/ })
        .getByRole('button', { name: 'Back to Library' })
        .click();
      await syncViaSettings(tabletPage, 'Synced');

      // Laptop syncs and sees Easy cleared + Stats shows 1 won game
      await syncViaSettings(laptopPage, 'Synced');
      await expect(laptopPage.getByRole('button', { name: /^Easy$/ })).toBeVisible();
      await expect(laptopPage.getByRole('button', { name: /Easy Resume/ })).toBeHidden();
      await laptopPage.getByRole('button', { name: 'View Stats' }).click();
      const statsDialog = laptopPage.getByRole('dialog', { name: /Sudoku Statistics/ });
      const firstLaptopStat = statsDialog.locator('.hs-sudoku-stat-card').first();
      await expect(firstLaptopStat.locator('.hs-sudoku-stat-value')).toHaveText('1');
      await expect(firstLaptopStat.locator('.hs-sudoku-stat-label')).toHaveText('Won / 1 started');
      await statsDialog.getByRole('button', { name: 'Close Statistics' }).click();

      // 2. Offline Divergence & Conflict Resolution (D30)
      await laptopPage.getByRole('button', { name: 'Medium', exact: true }).click();
      await expect(laptopPage.getByRole('grid', { name: '9 by 9 Sudoku board' })).toBeVisible();
      const medSteps = await readRemainingCellsForSlot(laptopPage, 'medium');
      const m0 = medSteps[0]!;
      const m1 = medSteps[1]!;
      const m2 = medSteps[2]!;
      const m3 = medSteps[3]!;
      const m4 = medSteps[4]!;

      await laptopPage
        .getByRole('grid', { name: '9 by 9 Sudoku board' })
        .getByRole('gridcell', { name: new RegExp(`Row ${m0.row}, Column ${m0.col}`) })
        .click();
      await laptopPage.keyboard.press(m0.digit);
      await laptopPage.getByRole('button', { name: 'Back to Library' }).click();
      await syncViaSettings(laptopPage, 'Synced');

      await syncViaSettings(tabletPage, 'Synced');
      await expect(tabletPage.getByRole('button', { name: /Medium Resume/ })).toBeVisible();

      // Take both offline and make conflicting edits
      allowOfflineNetworkErrors = true;
      await laptopContext.setOffline(true);
      await tabletContext.setOffline(true);

      await laptopPage.getByRole('button', { name: /Medium Resume/ }).click();
      await laptopPage
        .getByRole('grid', { name: '9 by 9 Sudoku board' })
        .getByRole('gridcell', { name: new RegExp(`Row ${m1.row}, Column ${m1.col}`) })
        .click();
      await laptopPage.keyboard.press(m1.digit);
      await laptopPage.getByRole('button', { name: 'Back to Library' }).click();

      await tabletPage.getByRole('button', { name: /Medium Resume/ }).click();
      await tabletPage
        .getByRole('grid', { name: '9 by 9 Sudoku board' })
        .getByRole('gridcell', { name: new RegExp(`Row ${m2.row}, Column ${m2.col}`) })
        .click();
      await tabletPage.keyboard.press(m2.digit);
      await tabletPage.getByRole('button', { name: 'Back to Library' }).click();

      // Laptop online -> revision 2; Tablet online -> conflict!
      await laptopContext.setOffline(false);
      await tabletContext.setOffline(false);
      allowOfflineNetworkErrors = false;

      await syncViaSettings(laptopPage, 'Synced');
      await syncViaSettings(tabletPage, 'Sync conflict');

      // Conflict pill in header & 100dvh board layout check with conflict pill visible
      const conflictPill = tabletPage.getByRole('button', { name: 'Resolve Conflict' });
      await expect(conflictPill).toBeVisible();
      await tabletPage.getByRole('button', { name: 'Hard', exact: true }).click();
      await expect(tabletPage.getByRole('grid', { name: '9 by 9 Sudoku board' })).toBeVisible();
      await expect(tabletPage.getByRole('button', { name: 'Resolve Conflict' })).toBeVisible();
      const layoutMetrics = await tabletPage.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
      }));
      expect(layoutMetrics.scrollHeight).toBeLessThanOrEqual(layoutMetrics.innerHeight);
      await tabletPage.getByRole('button', { name: 'Back to Library' }).click();

      // Resume-time conflict guard opens SyncConflictModal; audit Axe in Light & Dark modes
      await tabletPage.getByRole('button', { name: /Medium Resume/ }).click();
      const conflictDialog = tabletPage.getByRole('dialog', { name: 'Resolve Sync Conflict' });
      await expect(conflictDialog).toBeVisible();
      await expect(conflictDialog.getByRole('heading', { name: 'This Device' })).toBeVisible();
      await expect(conflictDialog.getByRole('heading', { name: 'Cloud' })).toBeVisible();
      await expectNoSevereAxeViolations(tabletPage, 'SyncConflictModal (Light)');

      await conflictDialog.getByRole('button', { name: 'Keep Cloud Copy' }).click();
      await expect(conflictDialog).toBeHidden({ timeout: 15_000 });

      // Tablet should now hold Laptop's m1 digit cleanly and launch directly into Medium
      await expect(tabletGrid).toBeVisible();
      await expect(
        tabletGrid.getByRole('gridcell', { name: new RegExp(`Row ${m1.row}, Column ${m1.col}`) }),
      ).toHaveAttribute('aria-label', new RegExp(m1.digit));
      await tabletPage.getByRole('button', { name: 'Back to Library' }).click();
      await syncViaSettings(tabletPage, 'Synced');
      await syncViaSettings(laptopPage, 'Synced');

      // Now verify Keep This Device (force: true) path
      allowOfflineNetworkErrors = true;
      await laptopContext.setOffline(true);
      await tabletContext.setOffline(true);

      await laptopPage.getByRole('button', { name: /Medium Resume/ }).click();
      await laptopPage
        .getByRole('grid', { name: '9 by 9 Sudoku board' })
        .getByRole('gridcell', { name: new RegExp(`Row ${m3.row}, Column ${m3.col}`) })
        .click();
      await laptopPage.keyboard.press(m3.digit);
      await laptopPage.getByRole('button', { name: 'Back to Library' }).click();

      await tabletPage.getByRole('button', { name: /Medium Resume/ }).click();
      await tabletPage
        .getByRole('grid', { name: '9 by 9 Sudoku board' })
        .getByRole('gridcell', { name: new RegExp(`Row ${m4.row}, Column ${m4.col}`) })
        .click();
      await tabletPage.keyboard.press(m4.digit);
      await tabletPage.getByRole('button', { name: 'Back to Library' }).click();

      await laptopContext.setOffline(false);
      await tabletContext.setOffline(false);
      allowOfflineNetworkErrors = false;

      await syncViaSettings(laptopPage, 'Synced');
      await syncViaSettings(tabletPage, 'Sync conflict');

      await tabletPage.getByRole('button', { name: /Medium Resume/ }).click();
      await expect(conflictDialog).toBeVisible();
      await conflictDialog.getByRole('button', { name: 'Keep This Device' }).click();
      await expect(conflictDialog).toBeHidden({ timeout: 15_000 });
      await expect(tabletGrid).toBeVisible();
      await tabletPage.getByRole('button', { name: 'Back to Library' }).click();
      await syncViaSettings(tabletPage, 'Synced');

      await syncViaSettings(laptopPage, 'Synced');
      await laptopPage.getByRole('button', { name: /Medium Resume/ }).click();
      await expect(
        laptopGrid.getByRole('gridcell', { name: new RegExp(`Row ${m4.row}, Column ${m4.col}`) }),
      ).toHaveAttribute('aria-label', new RegExp(m4.digit));
      await laptopPage.getByRole('button', { name: 'Back to Library' }).click();
      await syncViaSettings(laptopPage, 'Synced');

      // 3. Lossless Offline Stats Merging (D31) & Split Preference Sync (D32)
      allowOfflineNetworkErrors = true;
      await laptopContext.setOffline(true);
      await tabletContext.setOffline(true);

      // Laptop offline: change theme to Warm Hearthside Dark + flagWrongValues, then win Easy
      await laptopPage.getByRole('button', { name: 'Settings' }).click();
      await laptopSettings.getByRole('button', { name: 'Warm Hearthside' }).click();
      await laptopSettings.getByRole('button', { name: 'Dark' }).click();
      await laptopSettings.getByLabel('Flag wrong values live (kid-friendly)').check();
      await laptopSettings.getByRole('button', { name: 'Close Settings' }).click();

      await laptopPage.getByRole('button', { name: 'Easy', exact: true }).click();
      await solveActiveBoardFromIndexedDb(laptopPage, 'easy');
      await laptopPage
        .getByRole('dialog', { name: /Puzzle Solved!/ })
        .getByRole('button', { name: 'Back to Library' })
        .click();

      // Tablet offline: uncheck local SFX mute, then win Hard
      await tabletPage.getByRole('button', { name: 'Settings' }).click();
      await tabletSettings.getByLabel('Sound effects (SFX)').uncheck();
      await tabletSettings.getByRole('button', { name: 'Close Settings' }).click();

      await tabletPage.getByRole('button', { name: /^Hard/ }).click();
      await solveActiveBoardFromIndexedDb(tabletPage, 'hard');
      await tabletPage
        .getByRole('dialog', { name: /Puzzle Solved!/ })
        .getByRole('button', { name: 'Back to Library' })
        .click();

      // Reconnect both and sync -> Tablet gets Warm Hearthside Dark + flagWrongValues while keeping SFX muted
      await laptopContext.setOffline(false);
      await tabletContext.setOffline(false);
      allowOfflineNetworkErrors = false;

      await syncViaSettings(laptopPage, 'Synced');
      await syncViaSettings(tabletPage, 'Synced');
      await syncViaSettings(laptopPage, 'Synced');

      await expect(tabletPage.locator('html')).toHaveAttribute('data-theme', 'warm-hearthside');
      await expect(tabletPage.locator('html')).toHaveAttribute('data-mode', 'dark');
      await expect(tabletPage.locator('body')).toHaveCSS('background-color', 'rgb(28, 25, 23)');

      await tabletPage.getByRole('button', { name: 'Settings' }).click();
      await expect(
        tabletSettings.getByLabel('Flag wrong values live (kid-friendly)'),
      ).toBeChecked();
      await expect(tabletSettings.getByLabel('Sound effects (SFX)')).not.toBeChecked();
      await expectNoSevereAxeViolations(tabletPage, 'Settings Sync Card (Dark)');
      await tabletSettings.getByRole('button', { name: 'Close Settings' }).click();

      // Verify both devices hold all 3 won games after lossless record merge
      for (const p of [laptopPage, tabletPage]) {
        await p.getByRole('button', { name: 'View Stats' }).click();
        const sd = p.getByRole('dialog', { name: /Sudoku Statistics/ });
        const wonCard = sd.locator('.hs-sudoku-stat-card').first();
        await expect(wonCard.locator('.hs-sudoku-stat-value')).toHaveText('3');
        await expect(wonCard.locator('.hs-sudoku-stat-label')).toHaveText(/^Won \/ \d+ started$/);
        await sd.getByRole('button', { name: 'Close Statistics' }).click();
      }

      expect(pageErrors).toEqual([]);
      const unexpectedConsoleErrors = onlineConsoleErrors.filter(
        (msg) => !msg.includes('409 (Conflict)'),
      );
      expect(unexpectedConsoleErrors).toEqual([]);
      expect(onlineConsoleErrors).toHaveLength(2);
    } finally {
      await laptopContext.close();
      await tabletContext.close();
    }
  });
});

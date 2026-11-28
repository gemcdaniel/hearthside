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

const THEME_MODES = [
  {
    themeLabel: 'Clean Minimal',
    modeLabel: 'Light',
    themeId: 'clean-minimal',
    modeId: 'light',
    bodyBgRgb: 'rgb(248, 250, 252)',
  },
  {
    themeLabel: 'Clean Minimal',
    modeLabel: 'Dark',
    themeId: 'clean-minimal',
    modeId: 'dark',
    bodyBgRgb: 'rgb(11, 17, 32)',
  },
  {
    themeLabel: 'Warm Hearthside',
    modeLabel: 'Light',
    themeId: 'warm-hearthside',
    modeId: 'light',
    bodyBgRgb: 'rgb(250, 247, 242)',
  },
  {
    themeLabel: 'Warm Hearthside',
    modeLabel: 'Dark',
    themeId: 'warm-hearthside',
    modeId: 'dark',
    bodyBgRgb: 'rgb(28, 25, 23)',
  },
] as const;

function getLocalDateYYYYMMDD(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await page.evaluate(() =>
    Promise.allSettled(document.getAnimations({ subtree: true }).map((anim) => anim.finished)),
  );
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

async function syncViaSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  const settingsDialog = page.getByRole('dialog', { name: /Settings/ });
  await expect(settingsDialog).toBeVisible();
  const syncCard = settingsDialog.getByRole('region', { name: 'Cloud Sync Status' });
  await syncCard.getByRole('button', { name: 'Sync Now' }).click();
  await expect(syncCard.getByText('Synced', { exact: true })).toBeVisible({ timeout: 15_000 });
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
    const activeProfileId =
      window.localStorage.getItem('hearthside:active-profile-id') ?? 'profile-default-1';
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
      const match = saves.find(
        (s) => s.profileId === activeProfileId && s.slot === slotKey && s.deleted !== true,
      );
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

async function solveActiveBoardFromIndexedDb(
  page: Page,
  slot: string,
  options: { readonly useOneHint?: boolean } = {},
): Promise<void> {
  const grid = page.getByRole('grid', { name: '9 by 9 Sudoku board' });
  await expect(grid).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight))
    .toBe(true);

  if (options.useOneHint) {
    await page.getByRole('button', { name: 'Hint' }).click();
    await expect(page.getByTestId('sudoku-hint-card')).toBeVisible({ timeout: 15_000 });
  }

  const steps = await readRemainingCellsForSlot(page, slot);
  if (steps.length === 0) {
    throw new Error(`Expected at least 1 empty cell to solve in slot "${slot}"`);
  }

  const notesBtn = page.getByRole('button', { name: 'Notes' });
  if ((await notesBtn.getAttribute('aria-pressed')) === 'true') {
    await notesBtn.click();
    await expect(notesBtn).toHaveAttribute('aria-pressed', 'false');
  }

  const allButLast = steps.slice(0, -1);
  const lastStep = steps[steps.length - 1]!;
  for (const step of allButLast) {
    await grid
      .getByRole('gridcell', { name: new RegExp(`Row ${step.row}, Column ${step.col}`) })
      .click();
    await page.keyboard.press(step.digit);
  }

  // Wait until elapsedMs >= 2s to stay cleanly above D35's 1000ms server validation minimum.
  await expect(page.getByLabel(/^Elapsed time /)).toHaveText(
    /^(?:00:0[2-9]|00:[1-5]\d|0[1-9]:|[1-9]\d:)/,
    { timeout: 10_000 },
  );

  await grid
    .getByRole('gridcell', { name: new RegExp(`Row ${lastStep.row}, Column ${lastStep.col}`) })
    .click();
  await page.keyboard.press(lastStep.digit);

  await expect(page.getByRole('dialog', { name: /Puzzle Solved!/ })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('Phase 6 Multi-Household Leaderboards, Privacy & WCAG 2.1 AA E2E', () => {
  test.describe.configure({ mode: 'serial' });

  let tmpDir = '';
  let serverProc: ChildProcess | null = null;
  let serverOrigin = '';

  test.beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearthside-lb-e2e-'));
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
    const dbPath = path.join(tmpDir, 'leaderboards-e2e.db');

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

  test('verifies multi-household leaderboards, tamper 422, offline child queue, privacy toggles, nickname picker, and 4-theme WCAG 2.1 AA', async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const householdAContext: BrowserContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const householdBContext: BrowserContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });

    const pageA = await householdAContext.newPage();
    const pageB = await householdBContext.newPage();

    const pageErrors: string[] = [];
    const onlineConsoleErrors: string[] = [];
    let allowOfflineNetworkErrors = false;

    for (const p of [pageA, pageB]) {
      p.on('pageerror', (err) => pageErrors.push(err.message));
      p.on('console', (msg) => {
        if (msg.type() === 'error' && !allowOfflineNetworkErrors) {
          onlineConsoleErrors.push(msg.text());
        }
      });
    }

    const todayDate = getLocalDateYYYYMMDD();
    const dailySlot = `daily:${todayDate}:easy`;

    try {
      // 1. Bootstrap Household A, enforce D38 nickname guardrails + Fun Nickname Picker, create invite for Household B
      await pageA.goto(serverOrigin);
      await ensureServiceWorkerReady(pageA);
      await pageA.getByRole('button', { name: 'Settings' }).click();
      const settingsA = pageA.getByRole('dialog', { name: /Settings/ });
      const bootForm = settingsA.getByRole('form', { name: 'Set Up Household' });
      await bootForm.getByLabel('Household name').fill('Oakwood Family');
      await bootForm.getByLabel('Your display name').fill('Alex');
      await bootForm.getByLabel('Email address').fill('alex@example.com');
      await bootForm.getByLabel('Password (min 10 characters)').fill('oakwood-pass-123');
      await bootForm.getByRole('button', { name: 'Set Up Household' }).click();
      await expect(settingsA.getByText('Oakwood Family')).toBeVisible();

      await settingsA.getByRole('button', { name: 'Link Local' }).click();
      await expect(settingsA.getByRole('region', { name: 'Cloud Sync Status' })).toBeVisible();

      const childForm = settingsA.getByRole('form', { name: 'Add Child Profile' });
      const childNameInput = childForm.getByLabel(
        'Add child profile (no email or password needed)',
      );
      await childNameInput.fill('https://bad.example.com');
      await childForm.getByRole('button', { name: 'Add Child Profile' }).click();
      await expect(
        settingsA.getByText(/Nicknames cannot contain website links or URLs/i),
      ).toBeVisible();

      await childNameInput.fill('<script>');
      await childForm.getByRole('button', { name: 'Add Child Profile' }).click();
      await expect(settingsA.getByText(/Nicknames cannot include < or > brackets/i)).toBeVisible();

      await childForm.getByRole('button', { name: 'Fun Nicknames' }).click();
      await childForm.getByRole('button', { name: 'Cozy Fox' }).click();
      await expect(childNameInput).toHaveValue('Cozy Fox');
      await childForm.getByRole('button', { name: 'Add Child Profile' }).click();
      await expect(settingsA.getByText('Added child profile "Cozy Fox".')).toBeVisible();

      const childFriendsCheckbox = settingsA.getByLabel('Show Cozy Fox on Friends leaderboards');
      await expect(childFriendsCheckbox).not.toBeChecked();

      const inviteForm = settingsA.getByRole('form', { name: 'Create Invite' });
      await inviteForm.getByLabel('Invite type').selectOption('new_household');
      await inviteForm.getByLabel('Email hint (optional)').fill('blair@example.com');
      await inviteForm.getByRole('button', { name: 'Create Invite' }).click();
      const inviteUrl = await settingsA.getByLabel('One-time invite link').inputValue();
      expect(inviteUrl).toContain('/?invite=');

      // Add Cozy Fox to device, then switch active profile back to Player 1 (Alex)
      await settingsA.getByRole('button', { name: 'Add to Device' }).first().click();
      await expect(pageA.getByRole('button', { name: /Active profile: Cozy Fox/ })).toBeVisible();
      await settingsA.getByRole('button', { name: 'Close Settings' }).click();

      await pageA.getByRole('button', { name: /Active profile: Cozy Fox/ }).click();
      await pageA.getByRole('menuitemradio', { name: /Player 1/ }).click();
      await expect(pageA.getByRole('button', { name: /Active profile: Player 1/ })).toBeVisible();

      // Household B redeems new_household invite and links its local profile
      await pageB.goto(inviteUrl);
      await expect(pageB).toHaveURL(`${serverOrigin}/`);
      const settingsB = pageB.getByRole('dialog', { name: /Settings/ });
      await expect(settingsB).toBeVisible();
      const redeemForm = settingsB.getByRole('form', { name: 'Redeem Invite' });
      await redeemForm.getByLabel('Your display name').fill('Blair');
      await redeemForm.getByLabel('Email address').fill('blair@example.com');
      await redeemForm.getByLabel('Password (min 10 characters)').fill('birchwood-pass-123');
      await redeemForm
        .getByLabel('New household name (only for new-household invites)')
        .fill('Birchwood Family');
      await redeemForm.getByRole('button', { name: 'Create Account from Invite' }).click();
      await expect(settingsB.getByText('Birchwood Family')).toBeVisible();
      await settingsB.getByRole('button', { name: 'Link Local' }).click();
      await expect(settingsB.getByRole('region', { name: 'Cloud Sync Status' })).toBeVisible();
      await settingsB.getByRole('button', { name: 'Close Settings' }).click();

      // 2. D35 Server-side tamper rejection: altered 81-char grid returns 422 and creates 0 entries
      const meRes = await householdAContext.request.get(`${serverOrigin}/api/v1/auth/me`);
      expect(meRes.ok()).toBe(true);
      const meJson = (await meRes.json()) as {
        profiles: Array<{ id: string; isChild: boolean }>;
      };
      const adultA = meJson.profiles.find((p) => !p.isChild);
      expect(adultA).toBeTruthy();

      const dailyRes = await householdAContext.request.get(
        `${serverOrigin}/api/v1/puzzles/daily?date=${encodeURIComponent(todayDate)}&difficulty=easy`,
      );
      expect(dailyRes.ok()).toBe(true);
      const dailyJson = (await dailyRes.json()) as { puzzle: { id: string } };

      const tamperRes = await householdAContext.request.post(
        `${serverOrigin}/api/v1/leaderboards/submissions`,
        {
          headers: { Origin: serverOrigin },
          data: {
            profileId: adultA!.id,
            gameId: 'sudoku',
            puzzleId: dailyJson.puzzle.id,
            mode: 'daily',
            dailyDate: todayDate,
            solutionGrid: '1'.repeat(81),
            elapsedMs: 15_000,
            hintsUsed: 0,
          },
        },
      );
      expect(tamperRes.status()).toBe(422);

      const emptyBoardRes = await householdAContext.request.get(
        `${serverOrigin}/api/v1/leaderboards/daily?date=${encodeURIComponent(todayDate)}&difficulty=easy&scope=household`,
      );
      expect(emptyBoardRes.ok()).toBe(true);
      const emptyBoardJson = (await emptyBoardRes.json()) as { entries: unknown[] };
      expect(emptyBoardJson.entries).toHaveLength(0);

      // 3. Online Daily Solve on Household A (1 hint) -> Victory rank snippet & 4-theme Victory audit
      await pageA.getByRole('button', { name: /Daily Easy/ }).click();
      await solveActiveBoardFromIndexedDb(pageA, dailySlot, { useOneHint: true });
      const victoryA = pageA.getByRole('dialog', { name: /Puzzle Solved!/ });
      await expect(victoryA.getByText(/#1 of 1 in Household/)).toBeVisible({ timeout: 15_000 });
      await expect(victoryA.getByRole('button', { name: 'View Leaderboard' })).toBeVisible();

      for (const variant of THEME_MODES) {
        await pageA.evaluate(
          ([theme, mode]) => {
            document.documentElement.setAttribute('data-theme', theme);
            document.documentElement.setAttribute('data-mode', mode);
          },
          [variant.themeId, variant.modeId],
        );
        await expect(pageA.locator('body')).toHaveCSS('background-color', variant.bodyBgRgb);
        await expectNoSevereAxeViolations(
          pageA,
          `Victory Modal with rank (${variant.themeId}/${variant.modeId})`,
        );
      }
      await pageA.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'clean-minimal');
        document.documentElement.setAttribute('data-mode', 'light');
      });
      await expect(pageA.locator('body')).toHaveCSS('background-color', 'rgb(248, 250, 252)');

      await victoryA.getByRole('button', { name: 'View Leaderboard' }).click();
      const lbDialogA = pageA.getByRole('dialog', { name: 'Leaderboards' });
      await expect(lbDialogA).toBeVisible();
      await expect(lbDialogA.getByText('Alex')).toBeVisible();
      await expect(lbDialogA.getByText('1 hint')).toBeVisible();
      await pageA.keyboard.press('Escape');
      await expect(lbDialogA).toBeHidden();
      await pageA.getByRole('button', { name: 'Back to Library' }).click();

      // Household B solves cleanly (0 hints) -> Friends board shows Clean vs 1 hint, zero PII, No-Hint Only filter
      await pageB.getByRole('button', { name: /Daily Easy/ }).click();
      await solveActiveBoardFromIndexedDb(pageB, dailySlot, { useOneHint: false });
      const victoryB = pageB.getByRole('dialog', { name: /Puzzle Solved!/ });
      await expect(victoryB.getByText(/#1 of 1 in Household/)).toBeVisible({ timeout: 15_000 });
      await victoryB.getByRole('button', { name: 'View Leaderboard' }).click();

      const lbDialogB = pageB.getByRole('dialog', { name: 'Leaderboards' });
      await expect(lbDialogB).toBeVisible();
      await lbDialogB.getByRole('tab', { name: 'Friends' }).click();
      await expect(lbDialogB.getByText('Alex')).toBeVisible({ timeout: 10_000 });
      await expect(lbDialogB.getByText('Oakwood Family')).toBeVisible();
      await expect(lbDialogB.getByText('1 hint')).toBeVisible();
      await expect(lbDialogB.getByText('Blair')).toBeVisible();
      await expect(lbDialogB.getByText('Clean')).toBeVisible();
      await expect(lbDialogB).not.toContainText('@example.com');

      const noHintBtnB = lbDialogB.getByRole('button', { name: 'No-Hint Only' });
      await noHintBtnB.click();
      await expect(lbDialogB.getByText('Blair')).toBeVisible();
      await expect(lbDialogB.getByText('Alex')).toBeHidden();
      await noHintBtnB.click();
      await expect(lbDialogB.getByText('Alex')).toBeVisible();
      await pageB.keyboard.press('Escape');
      await expect(lbDialogB).toBeHidden();
      await pageB.getByRole('button', { name: 'Back to Library' }).click();

      // 4. Child offline Daily solve -> reconnect auto-post -> Family Daily & Friends privacy toggle
      await pageA.getByRole('button', { name: /Active profile: Player 1/ }).click();
      await pageA.getByRole('menuitemradio', { name: /Cozy Fox/ }).click();
      await expect(pageA.getByRole('button', { name: /Active profile: Cozy Fox/ })).toBeVisible();

      allowOfflineNetworkErrors = true;
      await householdAContext.setOffline(true);

      await pageA.getByRole('button', { name: /Daily Easy/ }).click();
      await solveActiveBoardFromIndexedDb(pageA, dailySlot, { useOneHint: false });
      const childVictory = pageA.getByRole('dialog', { name: /Puzzle Solved!/ });
      await expect(
        childVictory.getByText('Saved — will post to leaderboard when online'),
      ).toBeVisible({ timeout: 10_000 });
      await childVictory.getByRole('button', { name: 'Back to Library' }).click();

      await householdAContext.setOffline(false);
      allowOfflineNetworkErrors = false;
      await syncViaSettings(pageA);

      const familyCardA = pageA.getByRole('region', { name: "Today's Family Daily" });
      await expect(familyCardA.getByText('Alex')).toBeVisible({ timeout: 10_000 });
      await expect(familyCardA.getByText('Cozy Fox')).toBeVisible({ timeout: 10_000 });
      await expect(familyCardA.getByLabel(/^Easy: Solved in /)).toHaveCount(2);

      // Keyboard focus management on LeaderboardModal (Enter open + Escape focus restoration)
      const lbTriggerA = familyCardA.getByRole('button', { name: 'Leaderboards' });
      await lbTriggerA.focus();
      await pageA.keyboard.press('Enter');
      await expect(lbDialogA).toBeVisible();
      await expect(lbDialogA.getByText('Alex')).toBeVisible();
      await expect(lbDialogA.getByText('Cozy Fox')).toBeVisible();
      await pageA.keyboard.press('Escape');
      await expect(lbDialogA).toBeHidden();
      await expect(lbTriggerA).toBeFocused();

      // Household B Friends board MUST hide Cozy Fox while friendsVisible is OFF
      await pageB
        .getByRole('region', { name: "Today's Family Daily" })
        .getByRole('button', { name: 'Leaderboards' })
        .click();
      await expect(lbDialogB).toBeVisible();
      await lbDialogB.getByRole('tab', { name: 'Friends' }).click();
      await expect(lbDialogB.getByText('Alex')).toBeVisible();
      await expect(lbDialogB.getByText('Cozy Fox')).toBeHidden();
      await pageB.keyboard.press('Escape');
      await expect(lbDialogB).toBeHidden();

      // Household A enables Show Cozy Fox on Friends leaderboards -> Household B sees Cozy Fox cleanly
      await pageA.getByRole('button', { name: 'Settings' }).click();
      await expect(settingsA).toBeVisible();
      await childFriendsCheckbox.click();
      await expect(
        settingsA.getByText('Cozy Fox is now shown on Friends leaderboards.'),
      ).toBeVisible({ timeout: 10_000 });
      await expect(childFriendsCheckbox).toBeChecked();
      await settingsA.getByRole('button', { name: 'Close Settings' }).click();

      await pageB
        .getByRole('region', { name: "Today's Family Daily" })
        .getByRole('button', { name: 'Leaderboards' })
        .click();
      await expect(lbDialogB).toBeVisible();
      await lbDialogB.getByRole('tab', { name: 'Friends' }).click();
      await expect(lbDialogB.getByText('Cozy Fox')).toBeVisible({ timeout: 10_000 });
      await expect(lbDialogB).not.toContainText('@example.com');
      await pageB.keyboard.press('Escape');

      // 5. Per-puzzle leaderboard verification from Standard Easy solve
      await pageA.getByRole('button', { name: 'Easy', exact: true }).click();
      await solveActiveBoardFromIndexedDb(pageA, 'easy', { useOneHint: false });
      const stdVictory = pageA.getByRole('dialog', { name: /Puzzle Solved!/ });
      await expect(stdVictory.getByText(/#1 of 1 in Household/)).toBeVisible({ timeout: 15_000 });
      await stdVictory.getByRole('button', { name: 'View Leaderboard' }).click();
      await expect(lbDialogA).toBeVisible();
      await expect(lbDialogA.getByText('This Puzzle')).toBeVisible();
      await expect(lbDialogA.getByText('Cozy Fox')).toBeVisible();
      await pageA.keyboard.press('Escape');
      await expect(lbDialogA).toBeHidden();
      await pageA.getByRole('button', { name: 'Back to Library' }).click();

      // 6. WCAG 2.1 AA 4-theme/mode audit across Settings Nickname Picker, Family Daily, & LeaderboardModal tabs
      for (const variant of THEME_MODES) {
        await pageA.getByRole('button', { name: 'Settings' }).click();
        await expect(settingsA).toBeVisible();
        await settingsA.getByRole('button', { name: variant.themeLabel }).click();
        await settingsA.getByRole('button', { name: variant.modeLabel }).click();
        await expect(pageA.locator('html')).toHaveAttribute('data-theme', variant.themeId);
        await expect(pageA.locator('html')).toHaveAttribute('data-mode', variant.modeId);
        await expect(pageA.locator('body')).toHaveCSS('background-color', variant.bodyBgRgb);

        const funNickBtn = settingsA
          .getByRole('form', { name: 'Add Child Profile' })
          .getByRole('button', { name: /^Fun Nicknames$/ });
        if ((await funNickBtn.count()) > 0) {
          await funNickBtn.click();
        }
        await expectNoSevereAxeViolations(
          pageA,
          `Settings Nickname Picker & friendsVisible (${variant.themeId}/${variant.modeId})`,
        );
        await pageA.keyboard.press('Escape');
        await expect(settingsA).toBeHidden();

        await expectNoSevereAxeViolations(
          pageA,
          `Library Today's Family Daily (${variant.themeId}/${variant.modeId})`,
        );

        await familyCardA.getByRole('button', { name: 'Leaderboards' }).click();
        await expect(lbDialogA).toBeVisible();
        await lbDialogA.getByRole('tab', { name: 'Household' }).click();
        await expectNoSevereAxeViolations(
          pageA,
          `LeaderboardModal Household (${variant.themeId}/${variant.modeId})`,
        );

        await lbDialogA.getByRole('tab', { name: 'Friends' }).click();
        await expect(lbDialogA.getByText('Blair')).toBeVisible();
        await expectNoSevereAxeViolations(
          pageA,
          `LeaderboardModal Friends (${variant.themeId}/${variant.modeId})`,
        );

        const filterBtn = lbDialogA.getByRole('button', { name: 'No-Hint Only' });
        await filterBtn.click();
        await expect(filterBtn).toHaveAttribute('aria-pressed', 'true');
        await expectNoSevereAxeViolations(
          pageA,
          `LeaderboardModal Friends No-Hint Only (${variant.themeId}/${variant.modeId})`,
        );
        await filterBtn.click();
        await expect(filterBtn).toHaveAttribute('aria-pressed', 'false');
        await pageA.keyboard.press('Escape');
        await expect(lbDialogA).toBeHidden();
      }

      expect(pageErrors).toEqual([]);
      expect(onlineConsoleErrors).toEqual([]);
    } finally {
      await householdAContext.close();
      await householdBContext.close();
    }
  });
});

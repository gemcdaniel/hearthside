import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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
      // Server still starting up.
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

test.describe('Phase 4 Full-Stack Go Server + Single-Container PWA E2E', () => {
  test.describe.configure({ mode: 'serial' });

  let tmpDir = '';
  let serverProc: ChildProcess | null = null;
  let serverOrigin = '';

  test.beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearthside-e2e-'));
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
    const dbPath = path.join(tmpDir, 'e2e.db');

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
        HEARTHSIDE_PUZZLE_SCHEDULER_ENABLED: 'true',
        HEARTHSIDE_PUZZLE_POOL_TARGET: '3',
        HEARTHSIDE_PUZZLE_POOL_LOW_WATER: '1',
        HEARTHSIDE_PUZZLE_POOL_MAX_TOTAL: '10',
        HEARTHSIDE_DAILY_LOOKAHEAD_DAYS: '0',
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

  test('supports offline-first local play, bootstrap, D29 linking, child profiles, invites, server sync, offline reload, and WCAG 2.1 AA', async ({
    page,
  }) => {
    // 1. Local offline-first play works before signing in and saves progress locally.
    await page.goto(serverOrigin);
    await expect(page.getByText('Welcome, Player 1')).toBeVisible();

    await page.getByRole('button', { name: 'Easy', exact: true }).click();
    const grid = page.getByRole('grid', { name: '9 by 9 Sudoku board' });
    await expect(grid).toBeVisible();

    const firstEmpty = grid.getByRole('gridcell', { name: /, empty/ }).first();
    const emptyLabel = (await firstEmpty.getAttribute('aria-label')) ?? '';
    const coordMatch = /Row \d+, Column \d+/.exec(emptyLabel)?.[0] ?? 'Row 1, Column 1';
    await firstEmpty.click();
    await page.getByRole('button', { name: /Enter 5,/ }).click();
    await expect(grid.getByRole('gridcell', { name: new RegExp(coordMatch) })).toContainText('5');

    await page.getByRole('button', { name: 'Back to Library' }).click();
    await expect(page.getByRole('button', { name: /Easy Resume/ })).toBeVisible();

    // 2. Open Settings -> Account & Household -> audit signed-out UI (Light & Dark), then bootstrap.
    await page.getByRole('button', { name: 'Settings' }).click();
    const settingsDialog = page.getByRole('dialog', { name: /Settings/ });
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog.getByRole('heading', { name: 'Set Up Household' })).toBeVisible();

    await expectNoSevereAxeViolations(page, 'Signed-out Account UI (Light)');
    await settingsDialog.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 17, 32)');
    await expectNoSevereAxeViolations(page, 'Signed-out Account UI (Dark)');
    await settingsDialog.getByRole('button', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(248, 250, 252)');

    const bootstrapForm = settingsDialog.getByRole('form', { name: 'Set Up Household' });
    await bootstrapForm.getByLabel('Household name').fill('The Oakwood Family');
    await bootstrapForm.getByLabel('Your display name').fill('Alex');
    await bootstrapForm.getByLabel('Email address').fill('alex@example.com');
    await bootstrapForm.getByLabel('Password (min 10 characters)').fill('oakwood-pass-123');
    await bootstrapForm.getByRole('button', { name: 'Set Up Household' }).click();

    await expect(settingsDialog.getByText('The Oakwood Family')).toBeVisible();
    await expect(settingsDialog.getByText(/Signed in as Alex/)).toBeVisible();

    // 3. D29: Close Settings and confirm existing local profile save was NOT wiped after bootstrap.
    await settingsDialog.getByRole('button', { name: 'Close Settings' }).click();
    await page.getByRole('button', { name: /Easy Resume/ }).click();
    const resumedGrid = page.getByRole('grid', { name: '9 by 9 Sudoku board' });
    await expect(resumedGrid.getByRole('gridcell', { name: new RegExp(coordMatch) })).toContainText(
      '5',
    );
    await page.getByRole('button', { name: 'Back to Library' }).click();

    // 4. Link local Player 1 -> Alex, add Child Profile ("Sammy"), Add to Device (kid-friendly defaults ON).
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(settingsDialog).toBeVisible();

    await settingsDialog.getByRole('button', { name: 'Link Local' }).click();
    await expect(settingsDialog.getByText('On device (Player 1)')).toBeVisible();

    const addChildForm = settingsDialog.getByRole('form', { name: 'Add Child Profile' });
    await addChildForm.getByLabel('Add child profile (no email or password needed)').fill('Sammy');
    await addChildForm.getByRole('button', { name: 'Child avatar fox' }).click();
    await addChildForm.getByRole('button', { name: 'Child accent amber' }).click();
    await addChildForm.getByRole('button', { name: 'Add Child Profile' }).click();

    await expect(settingsDialog.getByText('Added child profile "Sammy".')).toBeVisible();
    await settingsDialog.getByRole('button', { name: 'Add to Device' }).first().click();

    await expect(page.getByRole('button', { name: /Active profile: Sammy/ })).toBeVisible();
    await expect(settingsDialog.getByLabel('Flag wrong values live (kid-friendly)')).toBeChecked();

    // Audit signed-in Account & Household UI in Light and Dark modes.
    await expectNoSevereAxeViolations(page, 'Signed-in Account UI (Light)');
    await settingsDialog.getByRole('button', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 17, 32)');
    await expectNoSevereAxeViolations(page, 'Signed-in Account UI (Dark)');
    await settingsDialog.getByRole('button', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(248, 250, 252)');

    // 5. Create join_household invite link, capture URL, sign out, verify local profiles remain intact.
    const inviteForm = settingsDialog.getByRole('form', { name: 'Create Invite' });
    await inviteForm.getByLabel('Invite type').selectOption('join_household');
    await inviteForm.getByLabel('Email hint (optional)').fill('jordan@example.com');
    await inviteForm.getByRole('button', { name: 'Create Invite' }).click();

    const inviteUrlInput = settingsDialog.getByLabel('One-time invite link');
    await expect(inviteUrlInput).toBeVisible();
    const inviteUrl = await inviteUrlInput.inputValue();
    expect(inviteUrl).toContain('/?invite=');

    await settingsDialog.getByRole('button', { name: 'Sign Out' }).click();
    await expect(settingsDialog.getByRole('button', { name: 'Sign In' }).first()).toBeVisible();
    await settingsDialog.getByRole('button', { name: 'Close Settings' }).click();

    await expect(page.getByText('Welcome, Sammy')).toBeVisible();

    // 6. Follow captured invite URL -> URL bar stripped -> Redeem Invite opens prefilled -> register Jordan.
    await page.goto(inviteUrl);
    await expect(page).toHaveURL(`${serverOrigin}/`);
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog.getByLabel('Invite code')).not.toHaveValue('');

    const redeemForm = settingsDialog.getByRole('form', { name: 'Redeem Invite' });
    await redeemForm.getByLabel('Your display name').fill('Jordan');
    await redeemForm.getByLabel('Email address').fill('jordan@example.com');
    await redeemForm.getByLabel('Password (min 10 characters)').fill('jordan-pass-123');
    await redeemForm.getByRole('button', { name: 'Create Account from Invite' }).click();

    await expect(settingsDialog.getByText('The Oakwood Family')).toBeVisible();
    await expect(settingsDialog.getByText(/Signed in as Jordan/)).toBeVisible();

    await settingsDialog.getByRole('button', { name: 'Sync Now' }).click();
    await expect(settingsDialog.getByText(/Server sync: [1-9]\d* cached bank/)).toBeVisible({
      timeout: 20_000,
    });
    await settingsDialog.getByRole('button', { name: 'Close Settings' }).click();

    // 7. Ensure Service Worker controls the page, go offline, reload, open cached Daily & run WASM hint.
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

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('requestfailed', (req) =>
      failedRequests.push(`${req.method()} ${req.url()} (${req.failure()?.errorText ?? 'failed'})`),
    );

    await page.context().setOffline(true);
    await page.reload();
    await expect(page.getByText('Welcome, Sammy')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /Daily Easy/ }).click();
    const offlineDailyGrid = page.getByRole('grid', { name: '9 by 9 Sudoku board' });
    await expect(offlineDailyGrid).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Hint' }).click();
    await expect(page.getByTestId('sudoku-hint-card')).toBeVisible({ timeout: 15_000 });

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
});

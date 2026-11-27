import { expect, test } from '@playwright/test';

test.describe('PWA Offline, Theme-Color Sync & Performance Hardening', () => {
  test('makes zero external network requests and dynamically syncs meta[name="theme-color"]', async ({
    page,
  }) => {
    const externalUrls: string[] = [];
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        if (url.origin !== 'http://localhost:4173') {
          externalUrls.push(req.url());
        }
      }
    });

    await page.goto('/');
    await expect(page.getByText('Welcome, Player 1')).toBeVisible();

    const metaThemeColor = page.locator('meta[name="theme-color"]');
    await expect(metaThemeColor).toHaveAttribute('content', '#f8fafc');

    // Switch through all 4 theme x mode pairs and confirm dynamic meta[name="theme-color"]
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: /Settings/ });

    await dialog.getByRole('button', { name: 'Dark' }).click();
    await expect(metaThemeColor).toHaveAttribute('content', '#0b1120');

    await dialog.getByRole('button', { name: 'Warm Hearthside' }).click();
    await expect(metaThemeColor).toHaveAttribute('content', '#1c1917');

    await dialog.getByRole('button', { name: 'Light' }).click();
    await expect(metaThemeColor).toHaveAttribute('content', '#faf7f2');

    await dialog.getByRole('button', { name: 'Close Settings' }).click();

    // Launch Sudoku & run WASM hint to confirm all fonts, assets, and WASM come from localhost only
    await page.getByRole('button', { name: 'Easy', exact: true }).click();
    await page.getByRole('button', { name: 'Hint' }).click();
    await expect(page.getByTestId('sudoku-hint-card')).toBeVisible({ timeout: 15_000 });

    expect(externalUrls).toEqual([]);
  });

  test('cold-starts cleanly offline after Service Worker activation with zero console or request errors', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByText('Welcome, Player 1')).toBeVisible();

    await page.evaluate(async () => {
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.ready;
      }
    });
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller));
    if (!controlled) {
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
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()} (${req.failure()?.errorText ?? 'failed'})`);
    });

    // Cut network completely and cold-reload
    await page.context().setOffline(true);
    await page.reload();
    await expect(page.getByText('Welcome, Player 1')).toBeVisible({ timeout: 15_000 });

    // Exercise lazy Settings chunk offline
    await page.getByRole('button', { name: 'Settings' }).click();
    const settingsDialog = page.getByRole('dialog', { name: /Settings/ });
    await expect(settingsDialog).toBeVisible();
    await page.keyboard.press('Escape');

    // Launch Sudoku + execute WASM Hint offline
    await page.getByRole('button', { name: 'Easy', exact: true }).click();
    const grid = page.getByRole('grid', { name: '9 by 9 Sudoku board' });
    await expect(grid).toBeVisible();

    await page.getByRole('button', { name: 'Hint' }).click();
    await expect(page.getByTestId('sudoku-hint-card')).toBeVisible({ timeout: 15_000 });

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  for (const motion of ['reduce', 'no-preference'] as const) {
    for (const vp of [
      { name: 'Phone Portrait', width: 390, height: 844 },
      { name: 'Desktop', width: 1440, height: 900 },
    ] as const) {
      test(`keeps zero scroll and 0px board shift under reducedMotion="${motion}" on ${vp.name}`, async ({
        page,
      }) => {
        await page.emulateMedia({ reducedMotion: motion });
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto('/');
        await page.getByRole('button', { name: 'Easy', exact: true }).click();

        const frame = page.locator('.hs-sudoku-frame');
        await expect(frame).toBeVisible();

        const before = await page.evaluate(() => {
          const rect = document.querySelector('.hs-sudoku-frame')?.getBoundingClientRect();
          return {
            scrollHeight: document.documentElement.scrollHeight,
            innerHeight: window.innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            top: rect?.top ?? -1,
          };
        });

        expect(before.scrollHeight).toBeLessThanOrEqual(before.innerHeight);
        expect(before.scrollWidth).toBeLessThanOrEqual(before.innerWidth);

        await page.getByRole('button', { name: 'Auto-Show' }).click();
        await page.getByRole('button', { name: 'Hint' }).click();
        await expect(page.getByTestId('sudoku-hint-card')).toBeVisible({ timeout: 15_000 });

        const after = await page.evaluate(() => ({
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
          top: document.querySelector('.hs-sudoku-frame')?.getBoundingClientRect().top ?? -1,
        }));
        expect(after.scrollHeight).toBeLessThanOrEqual(after.innerHeight);
        expect(Math.abs(after.top - before.top)).toBe(0);
      });
    }
  }
});

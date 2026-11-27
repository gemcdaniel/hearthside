import { expect, test } from '@playwright/test';

for (const vp of [
  { name: 'Phone Portrait', width: 390, height: 844 },
  { name: 'Desktop', width: 1440, height: 900 },
] as const) {
  test(`keeps zero scroll and zero board shift on ${vp.name} (${vp.width}x${vp.height})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/');
    await page.getByRole('button', { name: 'Easy', exact: true }).click();

    const frame = page.locator('.hs-sudoku-frame');
    await expect(frame).toBeVisible();

    const metricsBefore = await page.evaluate(() => {
      const el = document.querySelector('.hs-sudoku-frame');
      const rect = el?.getBoundingClientRect();
      return {
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        top: rect?.top ?? -1,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
      };
    });

    expect(metricsBefore.scrollHeight).toBeLessThanOrEqual(metricsBefore.innerHeight);
    expect(metricsBefore.scrollWidth).toBeLessThanOrEqual(metricsBefore.innerWidth);
    expect(Math.abs(metricsBefore.width - metricsBefore.height)).toBeLessThanOrEqual(2);

    // Toggle Auto-Show ON -> 0px vertical board shift and zero scroll
    await page.getByRole('button', { name: 'Auto-Show' }).click();
    const topAfterAutoShow = await page.evaluate(
      () => document.querySelector('.hs-sudoku-frame')?.getBoundingClientRect().top ?? -1,
    );
    expect(Math.abs(topAfterAutoShow - metricsBefore.top)).toBe(0);

    // Open WASM Hint -> 0px vertical board shift and zero scroll
    await page.getByRole('button', { name: 'Hint' }).click();
    await expect(page.getByTestId('sudoku-hint-card')).toBeVisible({ timeout: 15_000 });

    const metricsAfterHint = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      top: document.querySelector('.hs-sudoku-frame')?.getBoundingClientRect().top ?? -1,
    }));
    expect(metricsAfterHint.scrollHeight).toBeLessThanOrEqual(metricsAfterHint.innerHeight);
    expect(Math.abs(metricsAfterHint.top - metricsBefore.top)).toBe(0);
  });
}

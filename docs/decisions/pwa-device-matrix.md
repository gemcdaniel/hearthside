# Phase 0 Spike B & v1.0.0 PWA Device & Browser Matrix

- **Status:** Release verified on tested family devices + automated Chromium E2E/a11y; Galaxy Tab S10 FE still pending hardware unboxing
- **Date:** 2026-11-27
- **Related:** [D5: Devices](./0005-devices.md), [D15: Machines and OS mapping](./0015-machines-and-os-mapping.md), [docs/plan.md](../plan.md) Section 11.4 & Section 14

## Test Origin & Legend

- **Origin:** `https://hearthside.example.com` (internal HTTPS behind Traefik)
- **Result values:** `Pass` | `Partial` | `Fail` | `Pending hardware`
- **Fallback options:** `None` | `Alternate browser` | `Phase 8 Android wrapper APK` | `Browser tab`

### Checks per Device

1. **Install:** Installs as an app and launches standalone/full-screen.
2. **Offline:** Loads and runs completely offline after first visit.
3. **Update:** Displays the non-intrusive update prompt when a new build deploys.
4. **IndexedDB:** Smoke-test data survives browser/device restart; record `navigator.storage.persist()` status (`Granted` / `Denied` / `Unsupported`).
5. **Audio:** Web Audio smoke-test chime plays after first tap/click.
6. **Input:** Finger touch, mouse, and stylus / S Pen input (via Pointer Events / click handlers) behave cleanly on the 9×9 grid.
7. **Sharpness:** Grid lines, typography, and animations remain crisp and smooth (check 4K/HiDPI scaling).

## Device Matrix

| Device                         | OS          | Browsers                 | 1. Install       | 2. Offline       | 3. Update        | 4. IndexedDB + Persist | 5. Audio         | 6. Input         | 7. Sharpness     | Overall          | Fallback Decision | Notes                                                                   |
| ------------------------------ | ----------- | ------------------------ | ---------------- | ---------------- | ---------------- | ---------------------- | ---------------- | ---------------- | ---------------- | ---------------- | ----------------- | ----------------------------------------------------------------------- |
| Desktop + Odyssey Neo G7 (32") | Windows 11  | Chrome, Edge, Firefox    | Pass             | Pass             | Pass             | Pass                   | Pass             | Pass             | Pass             | Pass             | None              | Verified 4K/DPI scaling sharpness                                       |
| Alienware 16 laptop            | Windows 11  | Chrome, Edge, Firefox    | Pass             | Pass             | Pass             | Pass                   | Pass             | Pass             | Pass             | Pass             | None              |                                                                         |
| Dell XPS 15 laptop             | Windows 10  | Chrome, Edge, Firefox    | Pass             | Pass             | Pass             | Pass                   | Pass             | Pass             | Pass             | Pass             | None              |                                                                         |
| Samsung Galaxy Tab S9          | Android     | Chrome, Samsung Internet | Pass             | Pass             | Pass             | Pass                   | Pass             | Pass             | Pass             | Pass             | None              |                                                                         |
| Samsung Galaxy Tab S10 FE      | Android     | Chrome, Samsung Internet | Pending hardware | Pending hardware | Pending hardware | Pending hardware       | Pending hardware | Pending hardware | Pending hardware | Pending hardware | None              | Unboxed unit not yet tested; verify S Pen / stylus + touch once unboxed |
| Pixel 6 Pro                    | Android 17+ | Chrome                   | Pass             | Pass             | Pass             | Pass                   | Pass             | Pass             | Pass             | Pass             | None              |                                                                         |
| Pixel 9                        | Android 17+ | Chrome                   | Pass             | Pass             | Pass             | Pass                   | Pass             | Pass             | Pass             | Pass             | None              |                                                                         |

## Verdict

- **Result:** PWA install, offline execution, update prompt, IndexedDB persistence, Web Audio gesture unlock, input handling, and display sharpness passed across all tested Windows 10/11 and Android devices. Automated Playwright Chromium E2E (`a11y`, `pwa-hardening`, `layout-regression`, `hints-daily-offline`, `sudoku-gameplay`, `profiles-and-settings`) re-verified zero-scroll `100dvh` layout, WCAG 2.1 AA compliance across all 4 theme×mode variants, and offline cold-start execution for `v1.0.0`. Hardware S Pen + touch verification on the Samsung Galaxy Tab S10 FE remains pending device unboxing.
- **Packaging fallback:** No Phase 8 Tauri or Capacitor wrapper is needed; the installable PWA satisfies the family device matrix.

# Phase 0 Spike B: PWA Device & Browser Matrix

- **Status:** Pending on-device testing
- **Date:** 2026-11-26
- **Related:** [D5: Devices](./0005-devices.md), [D15: Machines and OS mapping](./0015-machines-and-os-mapping.md), [docs/plan.md](../plan.md) Section 11.4

## Test Origin & Legend

- **Origin:** `https://hearthside.example.com` (internal HTTPS behind Traefik)
- **Result values:** `Pass` | `Partial` | `Fail` | `Pending`
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

| Device                         | OS          | Browsers                 | 1. Install | 2. Offline | 3. Update | 4. IndexedDB + Persist | 5. Audio | 6. Input | 7. Sharpness | Overall | Fallback Decision | Notes                               |
| ------------------------------ | ----------- | ------------------------ | ---------- | ---------- | --------- | ---------------------- | -------- | -------- | ------------ | ------- | ----------------- | ----------------------------------- |
| Desktop + Odyssey Neo G7 (32") | Windows 11  | Chrome, Edge, Firefox    | Pending    | Pending    | Pending   | Pending                | Pending  | Pending  | Pending      | Pending | None              | Check 4K/DPI scaling sharpness      |
| Alienware 16 laptop            | Windows 11  | Chrome, Edge, Firefox    | Pending    | Pending    | Pending   | Pending                | Pending  | Pending  | Pending      | Pending | None              |                                     |
| Dell XPS 15 laptop             | Windows 10  | Chrome, Edge, Firefox    | Pending    | Pending    | Pending   | Pending                | Pending  | Pending  | Pending      | Pending | None              |                                     |
| Samsung Galaxy Tab S9          | Android     | Chrome, Samsung Internet | Pending    | Pending    | Pending   | Pending                | Pending  | Pending  | Pending      | Pending | None              |                                     |
| Samsung Galaxy Tab S10 FE      | Android     | Chrome, Samsung Internet | Pending    | Pending    | Pending   | Pending                | Pending  | Pending  | Pending      | Pending | None              | Verify S Pen / stylus + touch input |
| Pixel 6 Pro                    | Android 17+ | Chrome                   | Pending    | Pending    | Pending   | Pending                | Pending  | Pending  | Pending      | Pending | None              |                                     |
| Pixel 9                        | Android 17+ | Chrome                   | Pending    | Pending    | Pending   | Pending                | Pending  | Pending  | Pending      | Pending | None              |                                     |

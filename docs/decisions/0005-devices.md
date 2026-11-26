# D5: Devices

- **Status:** Confirmed
- **Date:** 2026-11-26

## Context

The app targets Windows, Linux, Android phones and tablets, Fire OS, and browser/PWA across the family's existing hardware, where PWA install, offline caching, storage persistence, and audio support can differ by browser.

## Decision

Verify the PWA on every family device listed in Section 2.1 of `docs/plan.md` during Phase 0 (`docs/decisions/pwa-device-matrix.md`). In particular, verify the Amazon Fire HD 10 Plus (2021, Fire OS) Silk browser's PWA install and offline behavior on the actual device, with a Chromium-based browser or a thin Android wrapper (Phase 8 Capacitor) as fallbacks.

## Consequences

- Device compatibility risks are surfaced in Phase 0 before full gameplay implementation.
- No Apple-specific platforms or targets are in scope.

# D5: Devices

- **Status:** Confirmed
- **Date:** 2026-11-26

## Context

The app targets Windows, Linux, Android phones and tablets, and browser/PWA across the family's existing hardware, where PWA install, offline caching, storage persistence, and audio support can differ by browser.

## Decision

Verify the PWA on every family device listed in Section 2.1 of `docs/plan.md` during Phase 0 (`docs/decisions/pwa-device-matrix.md`), targeting current evergreen browsers (Chrome, Edge, Firefox, Samsung Internet). Amazon Fire HD 10 Plus / Fire OS (Silk) has been retired from the support floor; thin wrappers (Phase 8 Tauri/Capacitor) remain optional fallbacks only if a supported device falls short.

## Consequences

- Device compatibility risks are surfaced in Phase 0 before full gameplay implementation.
- No Apple-specific platforms or targets are in scope.

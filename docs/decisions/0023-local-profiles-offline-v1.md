# D23: Local profiles in offline v1

- **Status:** Confirmed
- **Date:** 2026-11-27

## Context

Family members (parents and children) share devices such as tablets and living-room laptops before Phase 4 backend accounts arrive ([D14](./0014-playing-together.md)).

## Decision

Support lightweight same-device local profiles in offline v1 consisting of an ID, display name, preset SVG avatar icon, and preset accent color (no PIN or password required). Seed `"Player 1"` on first launch, expose a quick profile switcher in the shell header, and isolate each profile's theme/mode preference, audio toggles, Sudoku settings, in-progress saves, completed puzzles, and statistics in IndexedDB (`hearthside-db`).

## Consequences

- Switching profiles immediately applies the target profile's theme, light/dark mode, audio settings, and gameplay preferences.
- Deletion of the final remaining profile is prevented so the shell always has an active profile.
- Local profiles remain compatible with future household account linking in Phase 4–6.

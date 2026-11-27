# D32: Split preference sync

- **Status:** Confirmed
- **Date:** 2026-11-27

## Context

Some profile preferences represent how a player plays across all their devices (visual theme/mode and Sudoku mistake-checking rules such as kid-friendly wrong-value flagging), whereas audio mute states and volume sliders depend on the physical device's speakers or surroundings (e.g., muted phone vs. desktop speakers).

## Decision

Split profile preferences into two scopes:

- **Synced via LWW (`updatedAt`):** `theme`, `mode` (`light` | `dark`), and game-scoped gameplay settings (`{"sudoku":{"flagDuplicateConflicts":...,"flagWrongValues":...}}`). Older updates return `{ applied: false }` without overwriting newer cloud preferences.
- **Strictly device-local:** SFX/Music mute flags and volume levels remain in local device storage only and are rejected/stripped from server preference payloads.

## Consequences

- Child and adult visual/gameplay preferences follow the player seamlessly across devices.
- Unmuting sound on a desktop computer never surprises someone opening Hearthside on a phone in quiet mode.

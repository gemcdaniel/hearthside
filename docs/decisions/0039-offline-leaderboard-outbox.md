# D39: Offline-resilient leaderboard submission outbox

- **Status:** Confirmed
- **Date:** 2026-11-28

## Context

Consistent with Hearthside's offline-first architecture, signed-in family members frequently finish puzzles offline (e.g., on tablets away from home Wi-Fi) and expect their verified solve times to count once reconnected.

## Decision

Signed-in/linked profiles queue verified puzzle completions—including `puzzleId`, 81-character `solutionGrid`, `elapsedMs`, `hintsUsed`, and `completedAt`—in an IndexedDB outbox and flush submissions automatically alongside cloud sync triggers (D33) whenever connectivity resumes. Unlinked guest play never attempts server submissions.

## Consequences

- Offline solves earn their rightful leaderboard placement automatically on reconnect while preserving D35 authoritative solution validation.
- Offline and signed-out gameplay experience zero blocking or errors.

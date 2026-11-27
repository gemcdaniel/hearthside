# D22: Offline daily puzzles

- **Status:** Confirmed
- **Date:** 2026-11-27

## Context

An offline-first 1.0 release precedes the Phase 4 backend daily schedule, yet family members on separate devices should be able to play the same Daily Puzzle offline.

## Decision

Until Phase 4 introduces server-scheduled daily puzzles, compute the Daily Puzzle deterministically in the client WASM engine using a seed derived from `(YYYY-MM-DD, difficulty, engineVersion)` and cache the generated `PuzzleRecord` in IndexedDB for instant repeat visits. Regular play draws unused puzzles per profile and difficulty from the bundled 150-puzzle starter bank (`games/sudoku/src/data/starter-bank.json`) and generates fresh deterministic puzzles via WASM once a tier's starter pack is exhausted.

## Consequences

- Every family device gets the exact same Daily Puzzle offline without network access.
- Completed puzzle tracking per `(profileId, gameId, puzzleId)` avoids serving duplicates on the same device.

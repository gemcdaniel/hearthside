# D28: Daily puzzle seed parity with WASM

- **Status:** Confirmed
- **Date:** 2026-11-27

## Context

Hearthside `v1.0.0` introduced offline deterministic Daily Puzzles in WASM ([D22](./0022-offline-daily-puzzles.md)). Phase 4 introduces server-delivered Daily Puzzles and later phases compare household leaderboard times on each day's puzzle.

## Decision

The Go API generates and caches Daily Puzzles using the exact same `engine/sudoku` deterministic seed formula `(YYYY-MM-DD, difficulty, engineVersion)` used by the client WASM module.

## Consequences

- Signed-in online clients, cached offline clients, and offline-only guest players all receive the identical Daily Puzzle for a given date and difficulty tier.
- Server-side daily validation stays consistent with client-side generation and grading.

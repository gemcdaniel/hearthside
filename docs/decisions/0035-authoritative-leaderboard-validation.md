# D35: Authoritative server leaderboard validation

- **Status:** Confirmed
- **Date:** 2026-11-28

## Context

Client-submitted solve times and completion claims can be accidentally skewed by clock drift or tampered with if the server accepts unverified scores. Hearthside also supports three deterministic puzzle sources (server SQLite bank puzzles, canonical server/WASM Daily Puzzles, and the offline bundled 150-puzzle starter bank) without storing client solutions.

## Decision

Leaderboard submissions include `puzzleId`, an 81-character `solutionGrid`, `elapsedMs`, and `hintsUsed`. The Go API resolves `puzzleId` authoritatively across SQLite `puzzles`, canonical Daily computation via `engine/sudoku.DailySeed`, or the deterministic starter-bank generator (`engine/sudoku.GenerateStarterBankPuzzle`), verifies an exact 81-digit match against the authoritative solution, enforces `1000 <= elapsedMs <= 86_400_000` and `hintsUsed >= 0`, clamps future `completedAt` timestamps, and locks the first verified completion per `(profileId, gameId, puzzleId)`.

## Consequences

- Cheated or mismatched `solutionGrid` payloads are rejected with `422 Unprocessable Entity`, and unknown puzzles return `404`.
- Repeated submissions for the same puzzle never overwrite the initial verified completion (`created: false`).

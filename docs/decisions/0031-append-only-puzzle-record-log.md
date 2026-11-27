# D31: Append-only puzzle record log for stats

- **Status:** Confirmed
- **Date:** 2026-11-27

## Context

Incrementing aggregate counters (`gamesWon`, `totalPlayMs`, `bestTimeMs`) independently on multiple devices and syncing those aggregates via Last-Write-Wins causes lost wins, corrupted averages, and broken daily streaks when two devices play offline before syncing.

## Decision

Persist and sync immutable per-puzzle attempt/completion records keyed by `(profileId, gameId, puzzleId)`. Both server and client merge records idempotently and monotonically:

- A `completed` record never downgrades back to `started`.
- `started_at` keeps the earliest known start timestamp.
- Duplicate `completed` records for the same puzzle preserve the winner with the earliest `completed_at` (tie-breaking on lower `elapsed_ms`, then lower `hints_used`).
- Profile summary statistics and daily streaks recompute losslessly from the merged record set.

## Consequences

- Replaying batches or syncing out-of-order offline history from multiple devices produces identical, loss-free statistics.
- Stats can be extended with new breakdowns or leaderboard views without schema loss.

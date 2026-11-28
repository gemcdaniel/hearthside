# D36: Family-friendly leaderboard ranking

- **Status:** Confirmed
- **Date:** 2026-11-28

## Context

Family play includes both adults and children who may occasionally use progressive hints while learning techniques, alongside players competing hint-free.

## Decision

Rank leaderboard entries strictly by `elapsedMs ASC`, then `hintsUsed ASC`, then `completedAt ASC` (with `submittedAt ASC` as final tie-breaker), and support an optional `noHintsOnly=true` query filter restricting results to solves with `hints_used = 0`.

## Consequences

- Fast, hint-free solves win ties cleanly without penalizing learners in the default family board.
- Players wanting a pure no-hints comparison can toggle `noHintsOnly=true` on any Daily or per-puzzle leaderboard view.

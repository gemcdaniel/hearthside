# D30: Save slot conflict rule

- **Status:** Confirmed
- **Date:** 2026-11-27

## Context

Families using multiple devices can play the same Sudoku difficulty tier or Daily Puzzle on one device while offline and later sync against a server save slot that has already advanced on another device. Silently overwriting with Last-Write-Wins would destroy active board progress.

## Decision

Every server save slot `(profileId, gameId, slot)` carries a server-assigned monotonic `revision` starting at `1`:

- **Fast-forward:** A write whose `baseRevision` matches the current server `revision` (or `0` when creating a new slot) advances `revision` by `1` cleanly.
- **Same-puzzle completion auto-resolve:** If `baseRevision` disagrees on the same `puzzleId` and neither copy is a tombstone (`deleted = false`), and at least one side has `completed = true`, the completed copy wins automatically without bothering the player (`auto_completed_local` increments `revision`; `auto_completed_remote` preserves the completed server row).
- **Active divergence (`409 Conflict`):** All other `baseRevision` mismatches return HTTP `409 Conflict` carrying the full `serverSave` snapshot so the client can let the player compare summary metadata (`elapsedMs`, `filledCells`, `updatedAt`) and keep either version (`force: true`).

## Consequences

- No active player progress is ever silently overwritten by clock skew or offline divergence.
- Tombstones (`deleted = true`) propagate cleared slots across devices cleanly while still participating in revision conflict protection.

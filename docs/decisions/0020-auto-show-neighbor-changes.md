# D20: Auto-show candidate edits when neighbors change

- **Status:** Confirmed
- **Date:** 2026-11-27

## Context

Under [D12](./0012-editing-notes-with-auto-show.md), editing notes while auto-show is on modifies an active overlay without altering `manualNotes`. We need deterministic semantics for what happens to those overlay edits when the player subsequently places or clears digits in neighboring cells while auto-show stays enabled.

## Decision

While auto-show is ON, store two 9-bit bitmasks per cell layered over `computedCandidates`:

- `autoShowExcluded`: candidate digits the player explicitly eliminated while auto-show is active.
- `autoShowAdded`: candidate digits the player explicitly toggled on while auto-show is active.

Visible notes while auto-show is ON equal `((computedCandidates | autoShowAdded) & ~autoShowExcluded) & ~peerPlacedMask`. Logical eliminations (`autoShowExcluded`) and additions (`autoShowAdded`) persist across neighbor changes as long as auto-show remains ON, while newly placed peer digits always hide candidates automatically under [D8](./0008-sudoku-behavior.md). Toggling auto-show OFF discards both overlay masks and restores `manualNotes` untouched.

## Consequences

- Players do not lose manual candidate eliminations when filling unrelated or neighboring cells.
- State reducers and selectors remain pure, bitmask-based, and straightforward to verify in unit tests.

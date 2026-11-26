# D12: Editing notes while auto-show is on

- **Status:** Confirmed
- **Date:** 2026-11-26

## Context

When auto-show is enabled, players may still want to temporarily cross out or toggle candidates in a cell without losing the manual notes they entered before turning auto-show on.

## Decision

Adopt Option A: editing a cell's notes while auto-show is on modifies only that cell's visible notes in the active auto-show overlay (`autoShowOverrides`) until auto-show is turned off, at which point the player's saved manual notes return. Any note digit already held by a peer cell stays hidden under [D8](./0008-sudoku-behavior.md). Exact neighbor-change interactions on an edited auto-show cell are specified in Phase 2.

## Consequences

- Toggling auto-show ON/OFF is non-destructive to manual notes.
- State reducers maintain separate `manualNotes` and `autoShowOverrides` structures.

# D8: Sudoku behavior

- **Status:** Confirmed
- **Date:** 2026-11-26

## Context

Players rely on candidate notes and auto-show behavior behaving predictably when placing, clearing, or undoing digits.

## Decision

- Notes remain editable while auto-show is on; an edit updates that cell's visible notes until auto-show is turned off ([D12](./0012-editing-notes-with-auto-show.md)).
- Placing a digit removes that digit from view in the notes of affected peer squares (same row, column, or 3x3 box), even when auto-show is off. Those notes are hidden, never deleted: if the entry is cleared or undone, the notes return.
- The solving-technique difficulty tiers in Section 6.3 of `docs/plan.md` are the starting baseline and will be refined after family playtesting.

## Consequences

- Manual notes, computed candidates, and auto-show overrides must be stored in separate layers in `games/sudoku` and covered by dedicated reducer unit tests.

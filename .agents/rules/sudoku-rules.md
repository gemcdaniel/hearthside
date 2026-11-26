---
trigger: model_decision
description: "Apply when designing, implementing, or testing Sudoku gameplay logic, cell highlighting, candidate notes, auto-show behavior, hints, difficulty tiers, or Sudoku state reducers."
---

# Sudoku Gameplay & Invariant Rules

## State Model & Event Log
- All gameplay mutations must go through a pure, deterministic reducer driven by an append-only event log (`games/sudoku` implementing `packages/game-core`).
- Unlimited undo/redo, auto-save/resume (one in-progress game per difficulty), stats, and future Phase 9 real-time multiplayer all derive from this event log.

## Selection & Highlighting
- Selecting **any** cell (filled or empty) highlights its 3x3 box, row, and column.
- Selecting a filled cell also highlights all other cells on the board containing that same digit.
- Flag duplicate conflicts whenever two or more cells in the same row, column, or 3x3 box hold the same digit. Convey conflicts with both color and a non-color visual indicator.

## Notes & Auto-Show Invariants (D8 & D12 — Strictly Enforced)
Do not simplify or conflate these layers; write unit tests covering every transition below:

1. **Separate storage layers:** Maintain `manualNotes` (per-cell 9-bit mask) independently from `computedCandidates` (derived from current board digits) and `autoShowOverrides` (temporary edits made while auto-show is active).
2. **Hide, never delete, on peer placement (D8):** Whenever any cell in a row, column, or 3x3 box holds digit `d`, digit `d` is **hidden from rendered notes** in all peer cells—even when auto-show is OFF. Underlying `manualNotes` are **never mutated or deleted** by peer placements.
   - Clearing or undoing that placed digit immediately restores the hidden manual note `d` to view.
   - If a player adds manual note `d` to a cell whose peer already holds `d`, store `d` in `manualNotes` (or reflect the edit in the active view) while keeping it hidden from display until the peer conflict is removed.
3. **Auto-show ON / OFF transitions (D12 Option A):**
   - **Auto-show OFF:** Display `manualNotes & ~peerPlacedMask` for empty cells.
   - **Toggle ON:** Preserve `manualNotes` untouched in memory. Initialize the displayed notes for empty cells from `computedCandidates` (valid legal candidates for the current board).
   - **Edits while auto-show is ON:** Notes remain editable. Toggling a candidate modifies only the active auto-show overlay (`autoShowOverrides`) for that cell and does **not** alter `manualNotes`. Peer-placed digits remain hidden under Rule 2.
   - **Toggle OFF:** Discard `autoShowOverrides` and restore `manualNotes` (filtered by current peer placements).

## Difficulty Tiers (Starting Baseline)
A puzzle's difficulty equals the hardest technique required by the logical solver:
- **Easy:** Naked singles, hidden singles.
- **Medium:** Easy + naked pairs/triples, hidden pairs/triples, pointing pairs, box-line reduction.
- **Hard:** Medium + X-Wing, Swordfish, XY-Wing, and equivalent advanced patterns.

## Required v1 Gameplay Features
- **Hints:** Tiered progression evaluated against the **current board state** (not the original solution path): (1) highlight target region, (2) name the technique, (3) highlight driving cells and eliminations, (4) reveal the digit.
- **Mistake checking:** Support both live flagging and on-demand check modes.
- **Timer & pause:** Pausing stops the timer and conceals the board digits so players cannot solve while paused.
- **Local profiles:** Support quick same-device profile switching (Phase 2) with isolated saves and stats per profile.

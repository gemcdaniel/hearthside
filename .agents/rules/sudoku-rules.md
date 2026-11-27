---
trigger: model_decision
description: "Apply when designing, implementing, or testing Sudoku gameplay logic, cell highlighting, candidate notes, auto-show behavior, hints, difficulty tiers, or Sudoku state reducers."
---

# Sudoku Gameplay & Invariant Rules

## State Model & Event Log
- All gameplay mutations must go through a pure, deterministic reducer driven by an append-only event log (`games/sudoku` implementing `packages/game-core`).
- Unlimited undo/redo, auto-save/resume (one in-progress game per difficulty plus the active Daily Puzzle), stats, and future Phase 9 real-time multiplayer all derive from this event log.

## Selection & Highlighting
- Selecting **any** cell (filled or empty) highlights its 3x3 box, row, and column.
- Selecting a filled cell also highlights all other cells on the board containing that same digit.
- Flag duplicate conflicts whenever two or more cells in the same row, column, or 3x3 box hold the same digit and the profile's `flagDuplicateConflicts` setting is enabled (default ON, D21). Convey conflicts with both color and a non-color visual indicator.

## Notes & Auto-Show Invariants (D8, D12 & D20 — Strictly Enforced)
Do not simplify or conflate these layers; write unit tests covering every transition below:

1. **Separate storage layers:** Maintain `manualNotes` (per-cell 9-bit mask) independently from `computedCandidates` (derived from current board digits) and the active auto-show overlay (`autoShowExcluded` and `autoShowAdded` per-cell 9-bit masks layered over `computedCandidates`, D20).
2. **Hide, never delete, on peer placement (D8):** Whenever any cell in a row, column, or 3x3 box holds digit `d`, digit `d` is **hidden from rendered notes** in all peer cells—even when auto-show is OFF. Underlying `manualNotes` are **never mutated or deleted** by peer placements.
   - Clearing or undoing that placed digit immediately restores the hidden manual note `d` to view.
   - If a player adds manual note `d` to a cell whose peer already holds `d`, store `d` in `manualNotes` while keeping it hidden from display until the peer conflict is removed.
3. **Auto-show ON / OFF transitions (D12 Option A & D20):**
   - **Auto-show OFF:** Display `manualNotes & ~peerPlacedMask` for empty cells.
   - **Toggle ON:** Preserve `manualNotes` untouched in memory. Initialize `autoShowExcluded` and `autoShowAdded` to `0`, displaying `((computedCandidates | autoShowAdded) & ~autoShowExcluded) & ~peerPlacedMask`.
   - **Edits while auto-show is ON (D20):** Notes remain editable. Toggling a candidate updates only `autoShowExcluded` or `autoShowAdded` for that cell and does **not** alter `manualNotes`. Both `autoShowExcluded` (manual eliminations) and `autoShowAdded` persist across neighbor placements/removals while auto-show remains ON, while newly placed peer digits still hide candidates automatically under Rule 2 (`~peerPlacedMask`).
   - **Toggle OFF:** Discard `autoShowExcluded` and `autoShowAdded` and restore `manualNotes` untouched (`manualNotes & ~peerPlacedMask`).

## Difficulty Tiers (Starting Baseline)
A puzzle's difficulty equals the hardest technique required by the logical solver:
- **Easy:** Naked singles, hidden singles.
- **Medium:** Easy + pointing pairs/triples (`pointing_line`), box-line reduction (`box_line_reduction`), naked/hidden pairs, and naked/hidden triples.
- **Hard:** Medium + Skyscraper, X-Wing, W-Wing, XY-Wing, and Swordfish.

## Required v1 Gameplay Features
- **Mistake checking (D21):** Split into two independent per-profile booleans with **no 3-strike game-over**:
  1. `flagDuplicateConflicts` (default ON): highlights cells where two or more peers in the same row, column, or 3x3 box share a digit.
  2. `flagWrongValues` (kid-friendly default OFF): highlights non-given entries that do not match the puzzle's unique solution even without a peer duplicate.
  - Also provide an on-demand **Check Board** action regardless of live toggle settings.
- **Hints (4-tier progressive):** Evaluated against the **current board state** (not the original solution path). If the board has a peer conflict (`conflict`) or an unflagged wrong entry (`wrong_entry`), alert the player non-punishingly and offer to highlight/clear the incorrect cell before giving a logical hint. Otherwise step progressively: (1) highlight target region, (2) name the technique, (3) highlight driving cells and eliminations/placements, (4) apply the step via the event log.
- **Timer & pause:** Pausing stops the timer and conceals the board digits so players cannot solve while paused.
- **Local profiles (D23):** Support quick same-device profile switching with isolated saves, stats, theme/mode, and settings per profile.

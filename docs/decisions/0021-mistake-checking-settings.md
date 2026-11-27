# D21: Mistake checking settings

- **Status:** Confirmed
- **Date:** 2026-11-27

## Context

Children and casual family players benefit from gentle, configurable feedback without harsh failure states, while experienced players may want only rule-level duplicate conflict highlighting during a solve.

## Decision

Split mistake checking into two independent per-profile boolean settings with no 3-strike game-over:

1. **Flag duplicate conflicts (`flagDuplicateConflicts`, default ON):** highlights cells when two or more cells in the same row, column, or 3x3 box hold the same digit.
2. **Flag wrong values (`flagWrongValues`, kid-friendly, default OFF):** highlights non-given entries that disagree with the puzzle's unique solution even when no peer duplicate exists.

In addition, provide an on-demand **Check Board** action regardless of live toggle settings. If a player requests a hint while a peer conflict or unflagged wrong entry exists on the board, surface a helpful non-punishing alert before presenting a logical hint.

## Consequences

- Each local profile stores both booleans independently inside `ProfileSettings.sudoku`.
- Mistakes are conveyed with color plus non-color cues (border/icon/badge) and never lock players out of finishing a puzzle.

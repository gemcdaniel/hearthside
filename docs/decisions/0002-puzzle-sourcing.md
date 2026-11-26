# D2: Puzzle sourcing

- **Status:** Confirmed
- **Date:** 2026-11-26

## Context

Sudoku requires deterministic, uniquely solvable, difficulty-graded puzzles both offline on client devices and online via the family backend, as well as live hints evaluated against the current board.

## Decision

Use a hybrid approach: the Go backend generates the puzzle bank and daily puzzles; the app ships with a bundled starter pack and tops it up when online; and the same Go engine (`engine/sudoku`), compiled to WebAssembly, handles hints and offline generation on the device. A Phase 0 spike measures WASM size and speed (`docs/decisions/wasm-spike.md`), with a small TypeScript hint solver as the fallback if any budget fails.

## Consequences

- `engine/sudoku` must stay pure Go (standard library only, no HTTP/DB/OS dependencies) so native and `GOOS=js GOARCH=wasm` builds behave identically.
- WASM runs inside a Web Worker so the UI thread stays responsive.

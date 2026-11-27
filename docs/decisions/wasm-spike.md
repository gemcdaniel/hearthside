# Phase 0 Spike A: Go Sudoku Engine in WebAssembly

- **Status:** Confirmed — Standard Go WASM
- **Date:** 2026-11-26
- **Related:** [D2: Puzzle sourcing](./0002-puzzle-sourcing.md), [docs/plan.md](../plan.md) Section 11.3

## Goal & Performance Budgets

Verify whether compiling `engine/sudoku` to WebAssembly and running it inside a Web Worker meets Phase 0 size and latency budgets across supported family devices (current evergreen browsers on Windows 10/11 and Android):

| Metric                                | Budget                       |
| ------------------------------------- | ---------------------------- |
| Compressed WASM size (`gzip -9`)      | `<= 2 MiB` (2,097,152 bytes) |
| Worker + WASM cold start              | `< 1000 ms`                  |
| `nextHint` compute time (hard puzzle) | `< 200 ms`                   |

## Build Artifact Sizes

Measured via `scripts/build-wasm.sh` (`go version go1.27.4 linux/amd64`):

| Variant                                    | `.wasm` Raw              | `.wasm` Gzip-9         | Glue `.js` Raw      | Glue `.js` Gzip-9 | Size Budget (`<= 2 MiB`) |
| ------------------------------------------ | ------------------------ | ---------------------- | ------------------- | ----------------- | ------------------------ |
| Standard Go (`-ldflags="-s -w" -trimpath`) | 4,426,932 B (4.22 MiB)   | 1,213,947 B (1.16 MiB) | 16,992 B (16.6 KiB) | 4,368 B (4.3 KiB) | Pass                     |
| TinyGo (`-target=wasm -opt=z -no-debug`)   | _Not built (not needed)_ | —                      | —                   | —                 | —                        |

## Device Benchmark Measurements

Run via the **WASM Spike Benchmark** in the Phase 0 Diagnostics panel (10 iterations on the bundled hard puzzle fixture):

| Device / User-Agent  | Variant     | `.wasm` Raw | `.wasm` Gzip-9 | Cold Start | `nextHint` (med / p95) | `countSolutions` (med / p95) | Budget Verdict |
| -------------------- | ----------- | ----------- | -------------- | ---------- | ---------------------- | ---------------------------- | -------------- |
| Windows (Chrome 158) | Standard Go | 4.22 MiB    | 1.16 MiB       | 23.0 ms    | 0.20 / 8.20 ms         | 0.15 / 0.50 ms               | Pass           |

> **Retired Worst-Case Reference:** Before Amazon Fire OS was removed from the support floor, an Amazon Fire HD 10 Plus (`KFTRPWI`, Chrome 101) was also measured with Standard Go WASM at `291.5 ms` cold start and `3.80 / 34.40 ms` `nextHint`, still well inside every latency budget.

## Verdict

- **Chosen path:** **Standard Go WASM** (`GOOS=js GOARCH=wasm` executed inside a dedicated Web Worker). **TinyGo** and the **TypeScript fallback solver** are not needed.
- **Workbox precache requirement:** `workbox.maximumFileSizeToCacheInBytes` in `apps/web/vite.config.ts` must remain `>= 8 MiB` (currently `10 MiB`) so Workbox continues to precache the uncompressed `.wasm` binary as Phase 1 adds the full logical solver, generator, and grader.

## Phase 1 Production WASM Size Check

Measured via `scripts/build-wasm.sh` (`go version go1.27.4 linux/amd64`, `-ldflags="-s -w" -trimpath`) after completing the Phase 1 engine (`engine/sudoku` with Easy/Medium/Hard logical techniques, full grader, deterministic generator, and upgraded production WASM bridge):

- **Bridge methods exposed (`globalThis.hearthsideSudoku`):** `nextHint`, `generatePuzzle`, `gradePuzzle`, `countSolutions`, `nextStep`, `version`.

| Variant                                    | `.wasm` Raw            | `.wasm` Gzip-9         | Glue `.js` Raw      | Glue `.js` Gzip-9 | Budgets (`<= 2.00 MiB` gzip-9, `< 8 MiB` Workbox raw) |
| ------------------------------------------ | ---------------------- | ---------------------- | ------------------- | ----------------- | ----------------------------------------------------- |
| Standard Go (`-ldflags="-s -w" -trimpath`) | 4,593,230 B (4.38 MiB) | 1,260,367 B (1.20 MiB) | 16,992 B (16.6 KiB) | 4,368 B (4.3 KiB) | Pass                                                  |

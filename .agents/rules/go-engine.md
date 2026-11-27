---
trigger: model_decision
description: "Apply when working on Go modules (engine/sudoku, services/api), go.work, WebAssembly builds, the Sudoku solver/generator/grader, or backend deployment."
---

# Go Engine, WASM & Backend Rules

## Workspace & Package Purity
- Manage modules via root `go.work` joining `engine/sudoku` and `services/api`.
- **`engine/sudoku` must stay pure Go (standard library only):** No HTTP, SQLite, OS filesystem, environment variables, or global `math/rand` dependencies. It must compile identically for native Linux/Windows binaries and WebAssembly (`GOOS=js GOARCH=wasm`).
- Keep `services/api` dependent on `engine/sudoku`, never the reverse.

## Sudoku Engine Architecture
- **Board representation:** 81 cells storing digit (`0–9`), `given` flag, and a 9-bit candidate bitmask (`uint16` bits `1<<1` through `1<<9`) for fast allocation-free solving.
- **Determinism:** Generator takes an explicit `seed` and `engineVersion` using a local deterministic PRNG instance. Identical `(seed, engineVersion, targetDifficulty)` inputs must always produce the exact same puzzle and solution.
- **Two separate solvers:**
  1. **Logical solver:** Applies human solving techniques in ascending difficulty order, recording a structured step trace (`technique`, `targetCells`, `eliminations`, `placement`) for grading and live hints. Reject puzzles requiring guessing.
  2. **Backtracking solver:** Fast exact-cover/DFS solver used solely to count solutions and prove uniqueness (stop once count reaches 2; accept only count == 1).
- **Puzzle record fields:** `id`, `seed`, `engineVersion`, `difficulty`, `techniquesRequired`, `clues`, `solution`.

## WebAssembly & Worker Contract
- Execute the compiled WASM engine inside a **Web Worker** so the browser UI thread never freezes.
- Keep the JS/WASM bridge minimal and coarse-grained (pass serialized board/request payloads rather than chatty per-cell calls).
- Phase 0 performance budgets (across supported Windows 10/11 and Android devices): compressed WASM <= 2 MB, cold start < 1 s, hint calculation < 200 ms. (Spike A locked Standard Go WASM.)

## Backend & Deployment Constraints (Phase 4+)
- Private, invite-only family service running in Docker Compose behind Traefik over HTTPS (`hearthside.example.com`), internal-only until Phase 7 hardening.
- SQLite with versioned migrations; single Go binary in a minimal container image.
- Child profiles live under a parent household account (no child email/login collected). Avoid logging personal data; zero analytics.

## Verification
Run and pass before completing Go changes:
- `go vet ./engine/sudoku/... ./services/api/...`
- `go test -race ./engine/sudoku/... ./services/api/...`
- Inside each modified module: `golangci-lint run --config ../../.golangci.yml`
- When touching WASM bindings: verify `GOOS=js GOARCH=wasm go build ./...` succeeds in `engine/sudoku`.

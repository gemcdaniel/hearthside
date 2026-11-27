# Hearthside — Antigravity Workspace Rules

Read `docs/plan.md` for the full architecture, decisions (D1–D19), and current phase exit criteria before planning or implementing a new milestone.

## Hard Constraints (Never Violate)
- **Offline-first:** Core gameplay must never require network access or sign-in.
- **No analytics / kid-safe baseline:** Zero telemetry, third-party trackers, ads, external links, or free-text sharing. Children are primary users.
- **No Apple-specific targets:** Scope is Windows 10/11, Linux (Ubuntu), Android, and browser/PWA.
- **Asset provenance:** Never add an image, font, or audio file to `assets/` without recording its source, license, and tool terms in the asset manifest.
- **Display name:** Keep the app display name ("Hearthside") centralized in a single config constant.

## Tech Stack & Architecture Boundaries
- **Web tooling:** Use **Bun** (`bun install`, `bun run`, `bun.lock`) with **Vite** + `vite-plugin-pwa`, React, and strict TypeScript. Do **not** replace Vite with `bun build`.
- **Backend & Sudoku engine:** Go (`go.work` joining `engine/sudoku` and `services/api`). Keep `engine/sudoku` free of HTTP/DB dependencies so it compiles cleanly to WebAssembly (`GOOS=js GOARCH=wasm`).
- **Plugin isolation:** Game-specific logic lives in `games/<name>/` and communicates with `apps/web` only through `packages/game-core`. Never hardcode Sudoku logic into the shell.
- **Sudoku notes invariant (D8/D12):** Placing a digit hides that digit from affected peer notes without deleting underlying manual notes; clearing or undoing restores them. Toggling auto-show preserves manual notes in memory; edits while auto-show is on modify only the active auto-show view until toggled off.

## Environment & Verification Commands
- Repo lives in WSL2 Ubuntu (`~/projects/hearthside`). Do not run project builds under `/mnt/c`.
- Before finishing any task, run and verify the relevant checks pass cleanly:
  - Web: `bun run typecheck && bun run lint && bun run test && bun run build`
  - Go: `go vet ./engine/sudoku/... ./services/api/... && go test -race ./engine/sudoku/... ./services/api/...`
  - Go lint: run `golangci-lint run --config ../../.golangci.yml` inside modified Go modules.
- When implementing a phase step, verify against the phase's "Done when" criteria in `docs/plan.md` and leave working tests for every new behavior.

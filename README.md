# Hearthside (`v1.0.0`)

**Hearthside** is a free, offline-first, kid-safe family game app starting with **Sudoku**, built to run crisply across Windows 10/11, Linux, Android phones and tablets, and evergreen desktop/mobile browsers as an installable Progressive Web App (PWA).

---

## Highlights (`v1.0.0`)

- **100% Offline-First PWA:** Self-hosted variable fonts, vector SVG boards/icons, precached JS/CSS chunks, IndexedDB storage (`hearthside-db`), JSON save export/import, and a client-side Go WebAssembly engine with zero external CDN requests or telemetry.
- **Local Family Profiles:** Quick header switching with isolated saves, statistics, themes, audio levels, and mistake-checking preferences per profile.
- **Dual Themes & Responsive Zero-Scroll Layout:** **Clean Minimal** and **Warm Hearthside** in **Light** and **Dark** modes with dynamic `<meta name="theme-color">` sync, a locked `100dvh` zero-scroll gameplay viewport, Pointer Events (touch, mouse, and S Pen/stylus), and a compact Phone Landscape guard.
- **Pure-Go Standard WASM Sudoku Engine:** Allocation-free MRV uniqueness solver (`CountSolutions`), deterministic seeded generator, Easy/Medium/Hard logical solver & grader, 150-puzzle bundled starter bank + deterministic overflow, and deterministic offline Daily Puzzles seeded from `(YYYY-MM-DD, difficulty, engineVersion)`.
- **Thoughtful Sudoku Gameplay:** Layered `manualNotes` and editable `Auto-Show` candidate overlay (preserving manual notes in memory), split duplicate-conflict vs. kid-friendly wrong-value toggles, on-demand **Check Board**, unlimited undo/redo, 4-tier progressive WASM hints with wrong-entry guard, Pause curtain with `visibilitychange` auto-pause, per-profile statistics, and reduced-motion-safe micro-interactions.
- **Procedural Web Audio:** Synthesized SFX cues (`tap`, `place`, `note`, `erase`, `conflict`, `hint`, `unitComplete`, `win`) and per-theme procedural ambient soundscapes with click-free linear gain fades, live crossfading, and automatic tab-visibility pause/resume.
- **Accessibility:** WCAG 2.1 AA audited via `@axe-core/playwright` across all views and modals in all four theme×mode pairs, stacked dialog focus traps, full keyboard navigation with roving grid focus, and an `aria-live="polite"` gameplay announcer.

---

## Repository Structure

| Path                  | Purpose                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `apps/web/`           | Installable React + Vite PWA shell, IndexedDB storage, local profiles, Web Audio engine, E2E specs         |
| `packages/game-core/` | Framework-agnostic plugin contract, audio interface, profile/settings & storage abstractions               |
| `packages/ui/`        | Semantic `--hs-*` CSS design tokens (`Clean Minimal` / `Warm Hearthside`), `ThemeSwitcher`, `useFocusTrap` |
| `games/sudoku/`       | Sudoku plugin: pure deterministic reducer, event log, D8/D12/D20/D21 logic, starter bank, WASM worker & UI |
| `engine/sudoku/`      | Pure-Go Sudoku solver, grader, seeded generator, `genbank` CLI, and Standard Go WASM entrypoint            |
| `services/api/`       | Go backend API skeleton (prepared for Phase 4+ household sync and daily schedules)                         |
| `assets/`             | Asset provenance & license manifest (`assets/manifest.json`)                                               |
| `deploy/`             | Dockerfile, nginx config, and Docker Compose behind Traefik HTTPS                                          |
| `docs/`               | Architecture plan (`docs/plan.md`), design DNA (`docs/design/DESIGN.md`), and ADRs (`docs/decisions/`)     |

---

## Quick Start

### Prerequisites

- **Bun** `1.4.5+`
- **Go** `1.27+` (for engine tests and rebuilding WebAssembly artifacts)
- Optional (for linting Go modules): `golangci-lint`

### Local Development

```bash
# 1. Install JavaScript/TypeScript workspace dependencies
bun install

# 2. Build the Standard Go WASM binary + manifest into apps/web/public/wasm/
bun run build:wasm

# 3. Start the Vite development server
bun run --cwd apps/web dev
```

On WSL2 Windows setups, keep the repository inside the Linux filesystem (for example `~/projects/hearthside`), not under `/mnt/c`.

---

## Verification

Run the Web & Go verification suites locally before committing changes:

```bash
# Web / TypeScript / PWA
bun run typecheck
bun run lint
bun run format:check
bun run test
bun run build
bun run test:e2e

# Go modules
go vet ./engine/sudoku/... ./services/api/...
go test -race ./engine/sudoku/... ./services/api/...
(cd engine/sudoku && golangci-lint run --config ../../.golangci.yml)
(cd services/api && golangci-lint run --config ../../.golangci.yml)
```

---

## Deployment

Self-hosted container configuration lives in [`deploy/`](deploy/):

- [`deploy/Dockerfile`](deploy/Dockerfile) builds the static PWA + Go WASM assets into nginx.
- [`deploy/docker-compose.yml`](deploy/docker-compose.yml) wires Traefik HTTPS labels for `hearthside.example.com` (see `deploy/.env.example`).

---

## Documentation

- [Project Plan (`docs/plan.md`)](docs/plan.md)
- [Design DNA (`docs/design/DESIGN.md`)](docs/design/DESIGN.md)
- [Architecture Decision Records (`docs/decisions/`)](docs/decisions/README.md)
- [Changelog (`CHANGELOG.md`)](CHANGELOG.md)
- [Security & Privacy Policy (`SECURITY.md`)](SECURITY.md)
- [License (`LICENSE`)](LICENSE)

# Changelog

All notable changes to Hearthside are documented in this file.

## [1.0.0] - 2026-11-27

First complete offline-first release of Hearthside and Sudoku (`v1.0.0`), targeting Windows 10/11, Linux, Android phones/tablets, and evergreen browsers as an installable PWA.

### Added

- **Offline PWA Shell (`apps/web`, `packages/game-core`):**
  - Installable Vite PWA (`vite-plugin-pwa`) with Workbox precaching of all JS, CSS, self-hosted variable fonts, icons, and Standard Go WASM artifacts.
  - Framework-agnostic `GamePlugin` registry contract in `packages/game-core` isolating game plugins from shell chrome, profiles, audio, and storage.
  - IndexedDB persistence (`hearthside-db`) with `navigator.storage.persist()` support and JSON save backup Export/Import.
  - Local same-device profiles (display name, preset SVG avatar & accent color, quick header switcher) isolating saves, stats, themes, and Sudoku settings per profile.
  - Centralized `1.0.0` app version display alongside Go engine version in Settings & Developer Diagnostics, plus dynamic `<meta name="theme-color">` synchronization across theme/mode switches.
  - Privacy-first baseline: zero analytics, telemetry, ads, external network fetches, or free-text sharing.

- **Design System & Themes (`packages/ui`):**
  - Dual themes (**Clean Minimal** and **Warm Hearthside**) in **Light** and **Dark** modes powered exclusively by semantic `--hs-*` CSS custom properties and locally bundled `@fontsource-variable/plus-jakarta-sans` and `@fontsource-variable/fraunces` fonts.
  - Locked `100dvh` zero-scroll gameplay viewport with `0px` vertical board shift, purpose-built Phone Portrait, Tablet Portrait, Tablet Landscape / 4K Desktop breakpoints, and Phone Landscape orientation guard.
  - Shared `useFocusTrap` hook supporting `Tab`/`Shift+Tab` wrapping, `Escape` dismissal, nested dialog stacking, and focus restoration.

- **Pure-Go Sudoku Engine (`engine/sudoku` -> WebAssembly):**
  - Allocation-free 81-cell board with MRV backtracking uniqueness solver (`CountSolutions`) and deterministic seeded generator.
  - Logical solver & grader spanning Easy (`naked_single`, `hidden_single`), Medium (`pointing_line`, `box_line_reduction`, pairs, triples), and Hard (`skyscraper`, `x_wing`, `w_wing`, `xy_wing`, `swordfish`) techniques.
  - Pre-generated & verified 150-puzzle starter bank (`starter-bank.json`, 50 per tier) plus seamless deterministic WASM overflow generation and deterministic offline Daily Puzzles seeded from `(YYYY-MM-DD, difficulty, engineVersion)`.

- **Sudoku Gameplay & Accessibility (`games/sudoku`):**
  - Vector-crisp borderless 9×9 grid with SVG interior/box overlay, Pointer Events (touch, S Pen/stylus, mouse), and full keyboard navigation (arrow keys with roving focus, `1–9`, `Backspace`/`Delete`, `N`, `A`, `H`, `P`/`Escape`, `Ctrl+Z`/`Ctrl+Y`).
  - Independent `manualNotes` and `Auto-Show` candidate overlay (`D8`, `D12`, `D20`), preserving manual notes across peer placements and Auto-Show toggles.
  - Split mistake-checking toggles (`flagDuplicateConflicts` + kid-friendly `flagWrongValues`), non-punishing **Check Board**, 4-tier progressive WASM hints with wrong-entry guard, Pause curtain with auto-pause on `visibilitychange`, per-profile Statistics modal, and Victory modal.
  - Reduced-motion-safe GPU-composited micro-interactions (digit pop-in, completed-unit sweep + `unitComplete` cue, conflict/wrong micro-shake, victory wave) gated behind `@media (prefers-reduced-motion: no-preference)`.
  - WCAG 2.1 AA compliance verified via `@axe-core/playwright` across all views and modals in all 4 theme×mode combinations, concise cell `aria-label` note readouts, and `aria-live="polite"` gameplay status announcements.

- **Web Audio Engine (`apps/web/src/audio/`):**
  - Gesture-unlocked Web Audio synthesized SFX (`tap`, `place`, `note`, `erase`, `conflict`, `hint`, `unitComplete`, `win`).
  - Procedural per-theme ambient music engine (`ProceduralAmbientMusicChannel` behind an extensible `MusicChannel` interface) with **Clean Minimal** pentatonic/major-7th textures and **Warm Hearthside** low-passed felt-piano chords, click-free linear gain fades, live crossfading, and automatic pause/resume on `visibilitychange`.

---
trigger: model_decision
description: "Apply when creating, modifying, or testing frontend code, PWA/offline storage, UI themes, React components, Vite config, or packages/game-core and packages/ui."
---

# Frontend, UI & PWA Rules

## Tooling & TypeScript
- Use **Bun** for package management (`bun install`, `bun.lock`) and scripts, paired with **Vite** + `vite-plugin-pwa` for bundling. Never replace Vite with `bun build`.
- Target current evergreen browsers (**Chrome, Edge, Firefox, Samsung Internet**) on **Windows 10/11** and **Android**, keeping Vite on modern build targets (no legacy browser polyfills or downlevel transpilation).
- Enable TypeScript `strict: true` and `noUncheckedIndexedAccess: true`. Avoid `any`; use `unknown` and narrow explicitly.
- Keep Vitest (`bun run test`) for unit/component tests and Playwright for E2E tests.

## Monorepo Boundaries
- `apps/web`: PWA shell only (routing, library screen, local profiles, theme switcher, settings, storage, audio service, service worker prompt). Never import game-specific internals directly.
- `packages/game-core`: Game plugin contract, event-log reducer types, save/resume serialization, and shared input abstractions. Keep framework-agnostic (no React imports).
- `packages/ui`: CSS custom property design tokens, light/dark themes, and reusable accessible components.
- `games/<name>`: Game UI and rules glue implementing the `packages/game-core` plugin interface.

## Rendering, Themes & Accessibility
- **Vector-first:** Use SVG and CSS for game boards and UI chrome so lines and text stay crisp at 1x–3x pixel density from phones up to 32" 4K displays. Reserve raster images for illustrations/backgrounds.
- **Themes:** Define all colors, typography, spacing, corner radii, and motion timings as CSS variables in `packages/ui`. Never hardcode hex colors inside components. Every theme must support light and dark modes.
- **Kid-friendly & accessible baseline:** Use generous touch targets (minimum 44x44px), simple wording, strong contrast, and `prefers-reduced-motion` support. Never convey state (selection, errors, conflicts, givens) by color alone—pair with borders, icons, or weight.
- **Input:** Use standard **Pointer Events** / `click` handlers (never touch-only events such as `touchstart`/`touchend`) so finger touch, mouse, and **S Pen / stylus** input (e.g., on the Samsung Galaxy Tab S10 FE) work seamlessly across Windows 10/11 and Android. Include keyboard navigation and visible focus states for accessibility.

## Offline PWA & Browser APIs
- **Offline-first:** All gameplay, bundled fonts, icons, and starter puzzles must work with zero network access after first load. Never load fonts or scripts from external CDNs.
- **Persistence:** Store game state, profiles, and cached puzzles in IndexedDB. Call `navigator.storage.persist()` on startup and expose a manual save export/import path to protect against browser storage eviction.
- **Update UX:** Prompt the user before activating a waiting service worker so an active game is never interrupted mid-move.
- **Audio:** Unlock `AudioContext` only inside a user gesture handler; keep sound effects and music independently mutable.
- **No external links or telemetry:** Zero analytics, ads, trackers, or outbound links.

## Verification
Run and pass before completing frontend changes:
`bun run typecheck && bun run lint && bun run test && bun run build`

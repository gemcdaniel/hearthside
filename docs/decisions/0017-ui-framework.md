# D17: UI framework

- **Status:** Confirmed
- **Date:** 2026-11-26

## Context

Hearthside needs a mature, declarative component framework for the PWA shell, themeable design system, accessible Sudoku DOM/SVG board, and future game wrappers.

## Decision

Use **React** as the UI framework for `apps/web`, `packages/ui`, and game UIs (`games/*`), while keeping `packages/game-core` strictly framework-agnostic.

## Consequences

- Game reducers and plugin contracts in `packages/game-core` have zero React dependencies and remain cleanly unit-testable.
- Future canvas/WebGL games (e.g., PixiJS for card games) mount inside React plugin views.

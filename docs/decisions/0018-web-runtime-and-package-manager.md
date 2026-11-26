# D18: Web runtime and package manager

- **Status:** Confirmed / Proposed default
- **Date:** 2026-11-26

## Context

The frontend monorepo needs fast package management, workspace orchestration, TypeScript execution, bundling with mature PWA/Workbox support, unit/component testing, and browser E2E testing.

## Decision

Use **Bun (v1.4.5+)** as the package manager, workspace manager (`package.json` `workspaces` + `bun.lock`), and script runner, paired with **Vite (v8)** + `vite-plugin-pwa` for frontend dev/production bundling, **Vitest** for unit/component tests, and **Playwright** for E2E tests. Do not replace Vite with Bun's bundler because PWA/Workbox tooling depends on Vite.

**Fallback:** If any Vite/Workbox plugin hits a Bun compatibility issue in Phase 0, switch to Node.js 26 LTS + pnpm with zero application-code changes.

## Consequences

- Root scripts invoke workspace commands via `bun run --filter '*' <script>`.
- `bun.lock` is committed and verified in CI with `bun install --frozen-lockfile`.

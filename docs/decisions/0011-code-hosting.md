# D11: Code hosting

- **Status:** Confirmed
- **Date:** 2026-11-27

## Context

The monorepo needs private source control and automated verification for both the Bun/TypeScript workspaces and the Go modules.

## Decision

Host the code in a private GitHub repository named `hearthside` ([D13](./0013-project-name.md)), with GitHub Actions (`.github/workflows/ci.yml`) running `web`, `go`, and `e2e` (Playwright Chromium) build, lint, accessibility, and test jobs on pushes and pull requests targeting `main`. Following the `v1.0.0` asset provenance audit (`assets/manifest.json`), license the project code under the **MIT License** (`LICENSE`) while preserving upstream third-party licenses for bundled fonts and assets.

## Consequences

- `web`, `go`, and `e2e` CI jobs are required checks on `main`.
- Root `LICENSE` documents the MIT license for repository source code alongside `assets/manifest.json` for bundled assets.

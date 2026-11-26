# D11: Code hosting

- **Status:** Confirmed (GitHub repository) / Proposed (GitHub Actions CI)
- **Date:** 2026-11-26

## Context

The monorepo needs private source control and automated verification for both the Bun/TypeScript workspaces and the Go modules.

## Decision

Host the code in a private GitHub repository named `hearthside` ([D13](./0013-project-name.md)), with GitHub Actions (`.github/workflows/ci.yml`) running `web` and `go` build, lint, and test jobs on pushes and pull requests targeting `main`. Defer adding an open-source license file until asset licenses are audited.

## Consequences

- Both `web` and `go` CI jobs are required checks on `main`.
- No `LICENSE` file is committed during initial setup.

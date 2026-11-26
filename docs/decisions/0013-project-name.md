# D13: Project name

- **Status:** Confirmed
- **Date:** 2026-11-26

## Context

The project needs a consistent name across the repository, monorepo packages, and UI, while leaving open the option to rename cleanly if ever shared beyond the household.

## Decision

Name the project **Hearthside**, using `hearthside` for the GitHub repository and monorepo. Centralize the user-facing display name in a single config constant (`APP_DISPLAY_NAME` in `packages/game-core`) and recheck naming collisions before sharing outside the household.

## Consequences

- UI components and HTML titles reference the centralized display-name constant rather than scattering literal brand strings.

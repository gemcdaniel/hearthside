# D14: Playing together

- **Status:** Confirmed
- **Date:** 2026-11-26

## Context

Family members want multiple ways to enjoy Hearthside together across shared household devices and separate personal devices.

## Decision

Support all three modes across phased milestones:

1. Same-device play with quick local profile switching (Phase 2).
2. Shared household view with leaderboards and daily-puzzle results for all family members (Phases 4–6).
3. Live co-op and head-to-head play on one puzzle across devices (Phase 9), backed by an authoritative Go WebSocket server.

## Consequences

- Event-sourced game reducers in `packages/game-core` and `games/sudoku` support both local undo/save and future authoritative multiplayer synchronization.
- Co-op and head-to-head gameplay rules are specified prior to Phase 9.

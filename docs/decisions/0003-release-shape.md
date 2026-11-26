# D3: Release shape

- **Status:** Confirmed
- **Date:** 2026-11-26

## Context

Delivering full backend accounts, sync, leaderboards, and real-time multiplayer before shipping a playable Sudoku game would delay family playtesting and couple offline gameplay to server infrastructure.

## Decision

Ship an offline-first 1.0 release first (Phases 0–3), followed by backend features in follow-on phases (Phases 4–7 and 9). Until the backend daily puzzle service lands, the daily puzzle is drawn from the cached local puzzle bank.

## Consequences

- All core 1.0 Sudoku features work with zero network access.
- Backend features layer cleanly onto the client without breaking offline play.

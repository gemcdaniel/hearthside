# D29: Non-destructive local profile linking

- **Status:** Confirmed
- **Date:** 2026-11-27

## Context

Families using Hearthside `v1.0.0` offline accumulate local profiles, saved Sudoku games, notes, themes, and stats in IndexedDB before signing into a Phase 4 household server account.

## Decision

Linking a device to a household account merges or associates existing local profiles non-destructively with server-backed household profiles without deleting or overwriting local in-progress games, candidate notes, settings, or statistics. Signing out or going offline always preserves local playability.

## Consequences

- Upgrading from `v1.0.0` offline play to a connected Phase 4+ household carries existing family progress forward safely.
- Offline mode remains a first-class experience after account features are added.

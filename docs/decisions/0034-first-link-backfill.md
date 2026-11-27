# D34: First-link backfill

- **Status:** Confirmed
- **Date:** 2026-11-27

## Context

Players starting Hearthside offline accumulate local saves, completions, and preferences on a local profile before linking that local profile to a household profile (D29). Simply pulling server state on first link would either hide prior offline history from other devices or overwrite existing remote saves.

## Decision

When linking an existing local profile to a household profile for the first time, pull the server snapshot and run a full backfill through the normal D30–D32 merge path:

- Enqueue local completion/attempt history (`game_puzzle_records`) for idempotent monotonic upload.
- Compare local active saves against server slots under D30 (fast-forwarding empty server slots, auto-resolving same-puzzle completions, or surfacing `409 Conflict` if both devices have divergent active games on the same slot).
- Reconcile theme/gameplay preferences via D32 LWW timestamps.

## Consequences

- Linking a `v1.0.0` offline profile merges its history cleanly into the household cloud without silent overwrites.
- Child or adult progress earned before account creation immediately becomes available across household devices.

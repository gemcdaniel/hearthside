# D33: Durable offline sync queue and triggers

- **Status:** Confirmed
- **Date:** 2026-11-27

## Context

Mobile PWAs can lose connectivity mid-game, switch tabs, or be suspended by the OS immediately after a player finishes a move or puzzle. Keeping pending sync state only in React memory would drop unsynced saves and completion records.

## Decision

Track dirty save slots, unsynced puzzle records, and dirty preferences durably in IndexedDB. Flush queued work quietly whenever online and signed in:

- App startup and profile switch (`PullProfileSync` + flush dirty queue).
- Network `online` reconnect events and manual **Sync Now** in Settings.
- Gameplay lifecycle triggers: debounced moves during play, pause, puzzle completion, and `document.visibilitychange` (`hidden`) using `fetch(..., { keepalive: true })`.

## Consequences

- Offline play writes locally first with zero blocking network waits.
- Returning online from any device flushes pending moves, completions, and preference updates reliably.

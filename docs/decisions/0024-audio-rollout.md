# D24: Audio rollout

- **Status:** Confirmed
- **Date:** 2026-11-27

## Context

Browsers restrict audio playback until a user gesture occurs, and family players expect separate controls for quiet puzzle sound effects and background music.

## Decision

Implement the complete Web Audio service in Phase 2 with independent SFX and Music enable toggles and volume sliders persisted per profile, unlocking `AudioContext` on the first pointer or keyboard gesture. Provide synthesized Web Audio SFX cues (`tap`, `place`, `note`, `erase`, `conflict`, `hint`, `win`) in Phase 2, and keep a clean music channel interface ready for recorded/bundled music tracks added during Phase 3 polish.

## Consequences

- Zero external audio asset files or network fetches are needed in Phase 2.
- Both SFX and Music remain independently mutable across all games mounted inside the shell.

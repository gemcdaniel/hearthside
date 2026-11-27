# D24: Audio rollout

- **Status:** Confirmed
- **Date:** 2026-11-27

## Context

Browsers restrict audio playback until a user gesture occurs, and family players expect separate controls for quiet puzzle sound effects and background music.

## Decision

Implement the complete Web Audio service in Phase 2 with independent SFX and Music enable toggles and volume sliders persisted per profile, unlocking `AudioContext` on the first pointer or keyboard gesture. Provide synthesized Web Audio SFX cues (`tap`, `place`, `note`, `erase`, `conflict`, `hint`, `unitComplete`, `win`) and deliver **procedural Web Audio ambient music** tailored per theme (**Clean Minimal** airy pentatonic/major-7th; **Warm Hearthside** cozy low-passed felt-piano / mellow chords) in Phase 3 behind an extensible `MusicChannel` interface. Playback uses click-free linear/target gain fades, crossfades smoothly on live theme changes, and pauses/resumes automatically on `document.visibilitychange`, while allowing future `.ogg`/`.mp3` file-backed tracks to plug in later without changing Settings UI.

## Consequences

- Zero external audio asset files or network fetches are needed for v1.0 offline play.
- Both SFX and Music remain independently mutable across all games mounted inside the shell, with zero click/pop ramps and autoplay-safe gesture unlock.

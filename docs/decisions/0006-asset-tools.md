# D6: Asset tools

- **Status:** Confirmed
- **Date:** 2026-11-26

## Context

Hearthside needs polished visuals, optional sound effects, music, and bundled fonts with zero additional budget beyond existing subscriptions, while avoiding licensing surprises if ever shared more broadly.

## Decision

Use tools included with Google AI Pro plus free tools on Ubuntu. Phase 0 inventories available image, music, and sound tools and their output terms in `docs/assets/tool-inventory.md`. Every asset added to `assets/` must be recorded in the asset license manifest with its source, license, attribution, generating tool, and tool terms.

## Consequences

- No image, font, or audio file may enter `assets/` without a corresponding manifest entry.
- The manifest can be audited cleanly before any future sharing outside the household.

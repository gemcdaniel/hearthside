# D9: Child accounts

- **Status:** Confirmed
- **Date:** 2026-11-26

## Context

Children are primary users of Hearthside and play alongside parents, requiring safe family features without collecting child credentials or personal login data.

## Decision

Child profiles sit under a parent's household account so parents and children can play together within one household. Children do not need their own login or email for this model, even when they have Google Family accounts. Adult Google sign-in uses a Google Cloud OAuth client with a public HTTPS redirect address, and offline play never depends on sign-in.

## Consequences

- Zero child email addresses, personal telemetry, ads, external links, or free-text sharing.
- Same-device profile switching works offline with local profiles in Phase 2, and syncs under household accounts in Phases 4–6.

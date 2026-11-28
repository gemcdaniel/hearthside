# D37: Household and friends visibility scopes

- **Status:** Confirmed
- **Date:** 2026-11-28

## Context

Children are primary users of Hearthside (D9). While every family member should appear on their own household's Daily summary and leaderboards by default, child profiles should not automatically appear to invited friend households without parental opt-in.

## Decision

Support two leaderboard visibility scopes:

- `household` (default): all adult and child profiles belonging to the caller's household, plus a per-household Today's Family Daily summary covering all profiles and all three difficulties.
- `friends`: invited households on the private server filtered strictly by `friendsVisible = 1` (defaulting to `true` for adults and `false` for child profiles), toggleable by parents/adults on their own profile or child profiles in their household via `PATCH /api/v1/household/profiles/{id}`.

Leaderboard projections expose only display nickname, avatar, accent, child flag, household name, and solve metrics—never emails or user IDs.

## Consequences

- Parents retain full control over child visibility outside their household while keeping intra-household family competition automatic.
- Cross-household responses carry zero PII.

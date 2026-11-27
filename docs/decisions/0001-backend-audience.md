# D1: Backend audience

- **Status:** Confirmed
- **Date:** 2026-11-26

## Context

Hearthside is a private, family-focused game platform that eventually adds accounts, cloud save, daily puzzles, leaderboards, and multiplayer without becoming a public commercial service.

## Decision

The backend is private and invite-only for the family, hosted on the Ubuntu home server and eventually reachable from the internet. Adult accounts support Email + Password (Argon2id) and generic OpenID Connect (Discovery + PKCE for Google or any self-hosted IdP). The household, child account, and auth model is settled in [D9](./0009-child-accounts.md) and [D27](./0027-invite-email-and-oidc-auth.md).

## Consequences

- No public registration, monetization, ads, or user analytics are needed.
- Core offline gameplay must never depend on backend availability or sign-in.

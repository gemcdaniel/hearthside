# D27: Invite-only Email + Password & generic OIDC auth

- **Status:** Confirmed
- **Date:** 2026-11-27

## Context

Family adults may want either self-contained credentials or SSO via Google or a self-hosted homelab identity provider, while child profiles must stay simple and email-free ([D9](./0009-child-accounts.md)).

## Decision

Adult registration is strictly invite-only via one-time household invite tokens or admin CLI bootstrap—there is no public signup. Adult accounts support both Email + Password (Argon2id hashes) and generic OpenID Connect using Discovery + Authorization Code + PKCE (`HEARTHSIDE_OIDC_ISSUER_URL`, `CLIENT_ID`, `CLIENT_SECRET`, `PROVIDER_NAME`, `SCOPES`), supporting Google as well as self-hosted OIDC providers. Child profiles remain login-free members under a parent's household account.

## Consequences

- Households work immediately with Email + Password even before or without configuring an external OIDC provider.
- Switching between Google and a homelab OIDC provider requires only environment configuration, not code changes.

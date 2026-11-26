# D16: Test hostname and reverse proxy

- **Status:** Confirmed
- **Date:** 2026-11-26

## Context

Testing PWA installability and offline service workers on phones and tablets requires a real HTTPS origin rather than a WSL2 localhost URL behind NAT.

## Decision

Serve Hearthside at `https://hearthside.example.com` behind Traefik on the Ubuntu home server. Keep it reachable on the internal network only during Phase 0 and open it to the internet only after Phase 7 hardening.

## Consequences

- `deploy/` configures Docker Compose and Traefik labels for `hearthside.example.com`.
- Family Android, Fire OS, and Windows devices can test real PWA installs from Phase 0 Step 2 onward.

# D10: Access and deployment

- **Status:** Confirmed
- **Date:** 2026-11-26

## Context

Service workers and PWA installation require HTTPS, and the Ubuntu home server already routes services through Traefik.

## Decision

Deploy Hearthside with Docker Compose behind Traefik over HTTPS (`hearthside.example.com`), internal-only during Phase 0 and opened externally when ready ([D16](./0016-test-hostname-and-reverse-proxy.md)). Both the PWA and the future API are served over HTTPS.

## Consequences

- Mobile and tablet family devices can install and test the PWA over real HTTPS on the home network during Phase 0.
- External internet exposure waits until Phase 7 security hardening, rate limiting, and backup/restore verification.

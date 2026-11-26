# D4: Hosting

- **Status:** Confirmed
- **Date:** 2026-11-26

## Context

The family already operates an Ubuntu home server running self-hosted services (such as Plex and Immich) and needs a low-maintenance, zero-budget deployment target.

## Decision

Host Hearthside on the personal Ubuntu home server as a single Go binary backed by SQLite. Access and reverse-proxy deployment are governed by [D10](./0010-access-and-deployment.md) and [D16](./0016-test-hostname-and-reverse-proxy.md).

## Consequences

- SQLite with versioned migrations fits family scale and keeps operations simple, while remaining clean enough to migrate to Postgres later if needed.
- Backups and tested restore drills are required before external exposure (Phase 7).

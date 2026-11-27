# D26: Stdlib HTTP & pure-Go `modernc.org/sqlite`

- **Status:** Confirmed
- **Date:** 2026-11-27

## Context

Hearthside's backend targets a single self-hosted Ubuntu family server and needs minimal operational dependencies, static container builds, and tight sharing with `engine/sudoku`.

## Decision

`services/api` is implemented with the Go standard library `net/http` router (`METHOD /path`), structured JSON logging via `log/slog` (excluding PII, emails, passwords, and tokens), and pure-Go `modernc.org/sqlite` (`CGO_ENABLED=0`) with WAL mode, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`, `MaxOpenConns(1)`, and embedded transactional SQL migrations (`embed.FS`). `engine/sudoku` remains strictly pure Go with zero HTTP, database, or OS filesystem dependencies.

## Consequences

- `services/api` builds as a single static `CGO_ENABLED=0` binary runnable inside a minimal distroless container.
- Database schema changes live in versioned SQL files inside `services/api/internal/db/migrations/`.

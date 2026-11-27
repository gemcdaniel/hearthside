---
trigger: model_decision
description: "Apply when creating, modifying, or testing backend HTTP handlers, SQLite storage, migrations, authentication, or deployment files under services/api/** and deploy/**."
---

# Hearthside Go API & Deployment Rules

## Architecture & Module Boundaries
- Use Go's standard library `net/http` router (`METHOD /path`) and `log/slog` structured JSON logging in `services/api`.
- Keep `engine/sudoku` strictly pure Go (zero imports of `services/api`, SQLite, `net/http`, `os`, or `database/sql`).
- Keep backend features strictly optional to the client: offline v1.0 gameplay must never depend on API availability or sign-in.

## SQLite & Migrations
- Use pure-Go `modernc.org/sqlite` (`CGO_ENABLED=0`), never CGO `go-sqlite3`.
- Open SQLite with `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`, `journal_mode=WAL` (for file-backed DBs), and `SetMaxOpenConns(1)`.
- Store forward-only SQL migrations in `services/api/internal/db/migrations/*.sql` embedded via `embed.FS`, applying each migration inside a transaction tracked in `schema_migrations`.

## Security, Auth & Privacy
- Zero PII in logs: never log emails, passwords, password hashes, session tokens, invite tokens, OIDC client secrets, or user names in `log/slog` output.
- Use same-origin `/api/*` cookies (`HttpOnly`, `Secure` configurable `false` only for local HTTP dev, `SameSite=Lax`) storing hashes of opaque random tokens, and enforce `Origin`/`Referer` checks on mutating routes.
- Authenticate adult accounts invite-only via Email + Password (Argon2id) or generic OpenID Connect Discovery + PKCE; never require email or passwords for child profiles.

## Deployment & Verification
- Build minimal `CGO_ENABLED=0` static binaries (e.g., `deploy/Dockerfile.api` into `gcr.io/distroless/static-debian12:nonroot`) with a `/data` volume and `-healthcheck` probe.
- Run `go vet ./engine/sudoku/... ./services/api/...`, `go test -race ./engine/sudoku/... ./services/api/...`, and `golangci-lint run --config ../../.golangci.yml` inside `services/api` before completing changes.

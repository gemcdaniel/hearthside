# D25: Same-origin `/api/*` routing & cookie sessions

- **Status:** Confirmed
- **Date:** 2026-11-27

## Context

Serving the Hearthside PWA and Go API across different origins introduces CORS preflight overhead, third-party cookie restrictions on mobile browsers, and fragile token storage in `localStorage`.

## Decision

Serve the built PWA and `/api/*` from the single `services/api` container (`HEARTHSIDE_WEB_DIR=/srv/web`) on the same origin (`hearthside.example.com`) behind Traefik. Browser sessions use opaque random tokens hashed in SQLite and stored in `HttpOnly`, `SameSite=Lax` cookies (`Secure=true` in production; configurable `false` only for local HTTP development), paired with `Origin`/`Referer` verification on mutating routes. Unmatched `/api/*` paths return JSON `404`, and Vite Workbox configures `navigateFallbackDenylist: [/^\/api\//]` so the service worker never intercepts `/api/*` navigations or OAuth callbacks.

## Consequences

- Zero CORS configuration or `localStorage` bearer tokens are required for browser clients.
- Local development uses Vite's `/api` proxy to `http://127.0.0.1:8080`.

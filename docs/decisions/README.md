# Architecture Decision Records (D1–D39)

Decision log for Hearthside, derived from [docs/plan.md](../plan.md).

| ID  | Title                                  | Status                             | Date       | Record                                                                                         |
| --- | -------------------------------------- | ---------------------------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| D1  | Backend audience                       | Confirmed                          | 2026-11-26 | [0001-backend-audience.md](./0001-backend-audience.md)                                         |
| D2  | Puzzle sourcing                        | Confirmed                          | 2026-11-26 | [0002-puzzle-sourcing.md](./0002-puzzle-sourcing.md)                                           |
| D3  | Release shape                          | Confirmed                          | 2026-11-26 | [0003-release-shape.md](./0003-release-shape.md)                                               |
| D4  | Hosting                                | Confirmed                          | 2026-11-26 | [0004-hosting.md](./0004-hosting.md)                                                           |
| D5  | Devices                                | Confirmed                          | 2026-11-26 | [0005-devices.md](./0005-devices.md)                                                           |
| D6  | Asset tools                            | Confirmed                          | 2026-11-26 | [0006-asset-tools.md](./0006-asset-tools.md)                                                   |
| D7  | Timeline                               | Confirmed                          | 2026-11-26 | [0007-timeline.md](./0007-timeline.md)                                                         |
| D8  | Sudoku behavior                        | Confirmed                          | 2026-11-26 | [0008-sudoku-behavior.md](./0008-sudoku-behavior.md)                                           |
| D9  | Child accounts                         | Confirmed                          | 2026-11-26 | [0009-child-accounts.md](./0009-child-accounts.md)                                             |
| D10 | Access and deployment                  | Confirmed                          | 2026-11-26 | [0010-access-and-deployment.md](./0010-access-and-deployment.md)                               |
| D11 | Code hosting                           | Confirmed (GitHub) / Proposed (CI) | 2026-11-26 | [0011-code-hosting.md](./0011-code-hosting.md)                                                 |
| D12 | Editing notes while auto-show is on    | Confirmed                          | 2026-11-26 | [0012-editing-notes-with-auto-show.md](./0012-editing-notes-with-auto-show.md)                 |
| D13 | Project name                           | Confirmed                          | 2026-11-26 | [0013-project-name.md](./0013-project-name.md)                                                 |
| D14 | Playing together                       | Confirmed                          | 2026-11-26 | [0014-playing-together.md](./0014-playing-together.md)                                         |
| D15 | Machines and OS mapping                | Confirmed                          | 2026-11-26 | [0015-machines-and-os-mapping.md](./0015-machines-and-os-mapping.md)                           |
| D16 | Test hostname and reverse proxy        | Confirmed                          | 2026-11-26 | [0016-test-hostname-and-reverse-proxy.md](./0016-test-hostname-and-reverse-proxy.md)           |
| D17 | UI framework                           | Confirmed                          | 2026-11-26 | [0017-ui-framework.md](./0017-ui-framework.md)                                                 |
| D18 | Web runtime and package manager        | Confirmed / Proposed default       | 2026-11-26 | [0018-web-runtime-and-package-manager.md](./0018-web-runtime-and-package-manager.md)           |
| D19 | Agentic implementation workflow        | Confirmed                          | 2026-11-26 | [0019-agentic-implementation-workflow.md](./0019-agentic-implementation-workflow.md)           |
| D20 | Auto-show edits when neighbors change  | Confirmed                          | 2026-11-27 | [0020-auto-show-neighbor-changes.md](./0020-auto-show-neighbor-changes.md)                     |
| D21 | Mistake checking settings              | Confirmed                          | 2026-11-27 | [0021-mistake-checking-settings.md](./0021-mistake-checking-settings.md)                       |
| D22 | Offline daily puzzles                  | Confirmed                          | 2026-11-27 | [0022-offline-daily-puzzles.md](./0022-offline-daily-puzzles.md)                               |
| D23 | Local profiles in offline v1           | Confirmed                          | 2026-11-27 | [0023-local-profiles-offline-v1.md](./0023-local-profiles-offline-v1.md)                       |
| D24 | Audio rollout                          | Confirmed                          | 2026-11-27 | [0024-audio-rollout.md](./0024-audio-rollout.md)                                               |
| D25 | Same-origin `/api/*` & cookie sessions | Confirmed                          | 2026-11-27 | [0025-same-origin-api-and-cookies.md](./0025-same-origin-api-and-cookies.md)                   |
| D26 | Stdlib HTTP & pure-Go SQLite           | Confirmed                          | 2026-11-27 | [0026-stdlib-http-and-sqlite.md](./0026-stdlib-http-and-sqlite.md)                             |
| D27 | Invite-only Email & generic OIDC auth  | Confirmed                          | 2026-11-27 | [0027-invite-email-and-oidc-auth.md](./0027-invite-email-and-oidc-auth.md)                     |
| D28 | Daily puzzle seed parity with WASM     | Confirmed                          | 2026-11-27 | [0028-daily-puzzle-seed-parity.md](./0028-daily-puzzle-seed-parity.md)                         |
| D29 | Non-destructive local profile linking  | Confirmed                          | 2026-11-27 | [0029-local-profile-linking.md](./0029-local-profile-linking.md)                               |
| D30 | Save slot conflict rule                | Confirmed                          | 2026-11-27 | [0030-save-slot-conflict-rule.md](./0030-save-slot-conflict-rule.md)                           |
| D31 | Append-only puzzle record log          | Confirmed                          | 2026-11-27 | [0031-append-only-puzzle-record-log.md](./0031-append-only-puzzle-record-log.md)               |
| D32 | Split preference sync                  | Confirmed                          | 2026-11-27 | [0032-split-preference-sync.md](./0032-split-preference-sync.md)                               |
| D33 | Durable offline sync queue & triggers  | Confirmed                          | 2026-11-27 | [0033-durable-offline-sync-queue.md](./0033-durable-offline-sync-queue.md)                     |
| D34 | First-link backfill                    | Confirmed                          | 2026-11-27 | [0034-first-link-backfill.md](./0034-first-link-backfill.md)                                   |
| D35 | Authoritative leaderboard validation   | Confirmed                          | 2026-11-28 | [0035-authoritative-leaderboard-validation.md](./0035-authoritative-leaderboard-validation.md) |
| D36 | Family-friendly ranking                | Confirmed                          | 2026-11-28 | [0036-family-friendly-ranking.md](./0036-family-friendly-ranking.md)                           |
| D37 | Household and friends scopes           | Confirmed                          | 2026-11-28 | [0037-household-and-friends-scopes.md](./0037-household-and-friends-scopes.md)                 |
| D38 | Child-appropriate nicknames            | Confirmed                          | 2026-11-28 | [0038-child-appropriate-nicknames.md](./0038-child-appropriate-nicknames.md)                   |
| D39 | Offline leaderboard submission outbox  | Confirmed                          | 2026-11-28 | [0039-offline-leaderboard-outbox.md](./0039-offline-leaderboard-outbox.md)                     |

## Phase 0 Spike Reports

| Spike   | Title                                 | Status                               | Date       | Report                                         |
| ------- | ------------------------------------- | ------------------------------------ | ---------- | ---------------------------------------------- |
| Spike A | Go Sudoku engine in WebAssembly       | Confirmed (Standard Go WASM)         | 2026-11-26 | [wasm-spike.md](./wasm-spike.md)               |
| Spike B | PWA install, offline & storage matrix | Passed (Tab S10 FE pending hardware) | 2026-11-26 | [pwa-device-matrix.md](./pwa-device-matrix.md) |

# Architecture Decision Records (D1–D19)

Decision log for Hearthside, derived from [docs/plan.md](../plan.md).

| ID  | Title                               | Status                             | Date       | Record                                                                               |
| --- | ----------------------------------- | ---------------------------------- | ---------- | ------------------------------------------------------------------------------------ |
| D1  | Backend audience                    | Confirmed                          | 2026-11-26 | [0001-backend-audience.md](./0001-backend-audience.md)                               |
| D2  | Puzzle sourcing                     | Confirmed                          | 2026-11-26 | [0002-puzzle-sourcing.md](./0002-puzzle-sourcing.md)                                 |
| D3  | Release shape                       | Confirmed                          | 2026-11-26 | [0003-release-shape.md](./0003-release-shape.md)                                     |
| D4  | Hosting                             | Confirmed                          | 2026-11-26 | [0004-hosting.md](./0004-hosting.md)                                                 |
| D5  | Devices                             | Confirmed                          | 2026-11-26 | [0005-devices.md](./0005-devices.md)                                                 |
| D6  | Asset tools                         | Confirmed                          | 2026-11-26 | [0006-asset-tools.md](./0006-asset-tools.md)                                         |
| D7  | Timeline                            | Confirmed                          | 2026-11-26 | [0007-timeline.md](./0007-timeline.md)                                               |
| D8  | Sudoku behavior                     | Confirmed                          | 2026-11-26 | [0008-sudoku-behavior.md](./0008-sudoku-behavior.md)                                 |
| D9  | Child accounts                      | Confirmed                          | 2026-11-26 | [0009-child-accounts.md](./0009-child-accounts.md)                                   |
| D10 | Access and deployment               | Confirmed                          | 2026-11-26 | [0010-access-and-deployment.md](./0010-access-and-deployment.md)                     |
| D11 | Code hosting                        | Confirmed (GitHub) / Proposed (CI) | 2026-11-26 | [0011-code-hosting.md](./0011-code-hosting.md)                                       |
| D12 | Editing notes while auto-show is on | Confirmed                          | 2026-11-26 | [0012-editing-notes-with-auto-show.md](./0012-editing-notes-with-auto-show.md)       |
| D13 | Project name                        | Confirmed                          | 2026-11-26 | [0013-project-name.md](./0013-project-name.md)                                       |
| D14 | Playing together                    | Confirmed                          | 2026-11-26 | [0014-playing-together.md](./0014-playing-together.md)                               |
| D15 | Machines and OS mapping             | Confirmed                          | 2026-11-26 | [0015-machines-and-os-mapping.md](./0015-machines-and-os-mapping.md)                 |
| D16 | Test hostname and reverse proxy     | Confirmed                          | 2026-11-26 | [0016-test-hostname-and-reverse-proxy.md](./0016-test-hostname-and-reverse-proxy.md) |
| D17 | UI framework                        | Confirmed                          | 2026-11-26 | [0017-ui-framework.md](./0017-ui-framework.md)                                       |
| D18 | Web runtime and package manager     | Confirmed / Proposed default       | 2026-11-26 | [0018-web-runtime-and-package-manager.md](./0018-web-runtime-and-package-manager.md) |
| D19 | Agentic implementation workflow     | Confirmed                          | 2026-11-26 | [0019-agentic-implementation-workflow.md](./0019-agentic-implementation-workflow.md) |

## Phase 0 Spike Reports

| Spike   | Title                                 | Status                               | Date       | Report                                         |
| ------- | ------------------------------------- | ------------------------------------ | ---------- | ---------------------------------------------- |
| Spike A | Go Sudoku engine in WebAssembly       | Confirmed (Standard Go WASM)         | 2026-11-26 | [wasm-spike.md](./wasm-spike.md)               |
| Spike B | PWA install, offline & storage matrix | Passed (Tab S10 FE pending hardware) | 2026-11-26 | [pwa-device-matrix.md](./pwa-device-matrix.md) |

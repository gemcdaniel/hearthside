# D15: Machines and OS mapping

- **Status:** Confirmed
- **Date:** 2026-11-26

## Context

Clear environment mapping avoids WSL2 filesystem performance pitfalls and ensures every family machine and OS is covered in Phase 0 testing.

## Decision

Development runs on Windows 11 with WSL2 (Ubuntu), keeping the repository inside the WSL2 Linux filesystem (never `/mnt/c`) for native permissions and fast file watching. Family hardware and OS mapping across targets:

- Desktop + 32-inch Samsung Odyssey Neo G7 monitor (Windows 11)
- Alienware 16 laptop (Windows 11)
- Dell XPS 15 laptop (Windows 10)
- Home server (Ubuntu)
- Amazon Fire HD 10 Plus, 2021 (Fire OS)
- Samsung Galaxy Tab S9 & Tab S10 FE (Android)
- Pixel 6 Pro & Pixel 9 (Android 17+)

## Consequences

- All builds, tests, and watchers run inside Linux/WSL2.
- No Apple platforms are targeted.

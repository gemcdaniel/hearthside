# Security & Privacy Policy

## Privacy & Kid-Safe Baseline

Hearthside is designed for family play, including children, under strict privacy guarantees:

- **Zero analytics or tracking:** No third-party analytics SDKs, ad networks, beacons, or external script/font CDNs.
- **Offline-first local storage:** Profiles, saves, and statistics remain locally inside the browser's IndexedDB (`hearthside-db`).
- **No external links or free-text sharing:** v1.0 contains no outbound external links, user-to-user messaging, or public profiles.

## Supported Versions

| Version | Supported | Notes                                    |
| ------- | --------- | ---------------------------------------- |
| `1.0.x` | Yes       | Current offline-first PWA + WASM release |
| `< 1.0` | No        | Pre-release milestone builds             |

## Reporting a Vulnerability

This project is maintained privately for household use. If you discover a security, privacy, offline-storage, or WASM sandbox issue:

1. **Do not** disclose household hostnames, credentials, or reproduction details in public issues or external channels.
2. Report the issue directly to the repository owner via private message or an encrypted private channel with steps to reproduce and affected files.
3. Dependency updates and security patches are verified via GitHub Actions CI (`bun run test`, Go `-race` tests, `govulncheck`/vet, and Playwright checks) prior to release.

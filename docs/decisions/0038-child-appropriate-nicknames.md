# D38: Child-appropriate nicknames and zero free-text sharing

- **Status:** Confirmed
- **Date:** 2026-11-28

## Context

Profile names appear on shared household and friends leaderboards, and Hearthside enforces a strict kid-safe baseline with zero free-text chat, comments, or external links.

## Decision

Enforce strict server-side nickname validation (`ValidateNickname`): collapse whitespace, require 1–24 Unicode runes composed only of letters, digits, spaces, hyphens (`-`), and apostrophes (`'`), and reject control characters, HTML/angle brackets, and URL/domain substrings (`http://`, `https://`, `www.`, `.com`, `.net`, `.org`, etc.). Pair this with an optional preset kid-friendly nickname picker in the UI and keep leaderboards strictly free of comments or free-text sharing.

## Consequences

- Shared boards remain safe, readable, and age-appropriate without needing moderation tooling.
- Invalid profile names return `400 Bad Request` (`invalid_nickname`) consistently across signup, child profile creation, and renames.

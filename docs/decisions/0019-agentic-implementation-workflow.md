# D19: Agentic implementation workflow

- **Status:** Confirmed
- **Date:** 2026-11-26

## Context

Hearthside is implemented using Google Antigravity across frontend, Go/WASM engine, and Sudoku gameplay domains, which require consistent guardrails without bloating agent context.

## Decision

Keep `docs/plan.md` as the architectural source of truth, maintain a concise root `AGENTS.md` for always-on invariants and verification commands, and organize domain-specific guidance (`frontend-pwa.md`, `go-engine.md`, `sudoku-rules.md`) in `.agents/rules/*.md` using `trigger: model_decision` frontmatter.

## Consequences

- Agents load only the domain rules relevant to the active task.
- All changes must satisfy the verification commands listed in `AGENTS.md`.

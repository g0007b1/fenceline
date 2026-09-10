# ADR-0003: One hook implementation, adapters per runtime

Status: accepted
Date: 2026-09-10

## Context

Cursor, Claude Code, Codex, Gemini CLI and Copilot all run "JSON on stdin, JSON or exit code out" hooks, with different field names, event names and file locations.

## Decision

Guard logic is written once against a normalised payload. `hooks/lib/protocol.js` maps input fields and output shapes per runtime; `src/adapters/<runtime>.js` knows only where files go and how the config file is structured. The runtime is passed as `--runtime` argv so generated commands work on Windows shells too.

## Consequences

- Adding a runtime is one adapter file plus, if its wire format is new, one branch in `protocol.js`.
- A vendor schema change is a one-file fix with a regression case in `test/run.js`.
- Node is required even in Python / Go / Rust repos. Accepted: `npx` already implies it, and the alternative (one implementation per language) would drift.

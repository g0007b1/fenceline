# ADR-0004: Zero runtime dependencies

Status: accepted
Date: 2026-09-10

## Context

Hooks run on every tool call and on every stop. A slow start makes the agent feel broken; a dependency that fails to install makes every guard silently fail-open in runtimes that default to fail-open.

## Decision

No runtime dependencies. TOML / Makefile / go.mod parsing is done with small regex-based readers that extract only what the scanner needs (names, sections, targets).

## Consequences

- Parsers are deliberately shallow; exotic manifests may be under-detected. `scan` prints what it found so users can override with `--preset`.
- Hook start time stays in the tens of milliseconds.

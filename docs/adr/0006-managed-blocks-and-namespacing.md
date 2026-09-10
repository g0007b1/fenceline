# ADR-0006: Managed blocks and namespaced output

Status: accepted
Date: 2026-09-10

## Context

The tool must be re-runnable after the stack changes and removable without leaving traces, while users edit the generated docs freely.

## Decision

Generated docs carry `<!-- fenceline:managed:begin/end -->` markers; `refresh` replaces only the block. Everything else is namespaced (`.fenceline/`, `fenceline-*`) or merged into an existing hook config while preserving foreign entries. `uninstall` reverses exactly that set. A doc without markers is never overwritten unless `--force`.

## Consequences

- Users can keep their own sections around the block indefinitely.
- Domain docs are written once (`writeIfMissing`) and never refreshed automatically — their content is human judgement.

# ADR-0005: Triage is deterministic, not an LLM call

Status: accepted
Date: 2026-09-10

## Context

Orchestrators (bots, CI jobs) need a cheap, explainable first opinion on whether a task may run unattended. An LLM verdict would be slower, non-reproducible and would itself need guarding.

## Decision

`agent-ready triage` scores a task from the repository's own signals — risk zones the scanner found, protected paths, fragile zones — plus a small keyword list per preset. It returns a verdict with reasons and a scriptable exit code. The agent still applies the safe-list in context.

## Consequences

- False verdicts are possible and visible; the reasons list is the debugging tool.
- Keyword lists are data in presets and can be tuned per project below the managed block.

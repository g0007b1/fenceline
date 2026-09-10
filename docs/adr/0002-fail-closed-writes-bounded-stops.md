# ADR-0002: Fail closed for writes, bounded for stops

Status: accepted
Date: 2026-09-10

## Context

Two failure modes pull in opposite directions: a guard that cannot parse a payload could let a dangerous write through, and a stop hook facing a broken toolchain could trap the agent forever.

## Decision

- `guard-write` denies when it cannot determine the target path (`failClosed: true` by default).
- `ensure-checks` counts its own attempts and releases the agent after `maxStopAttempts` (default 4) with an explicit message, and runtimes also cap consecutive blocks.

## Consequences

- Strictness where the cost of a miss is a destroyed file; availability where the cost of a miss is a red PR that a human will see anyway.
- Users with unusual edit tools may see a false deny once; the message tells them how to allow it.

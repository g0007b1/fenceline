# ADR-0001: Enforce in the runtime, not in the prompt

Status: accepted
Date: 2026-09-10

## Context

Rules files (`.cursorrules`, `CLAUDE.md`, `AGENTS.md`) live in the context window and compete with everything else there. In practice agents violated "never edit `android/`" after reading it, typically late in long sessions.

## Decision

Every rule that matters is backed by a hook the runtime executes: `PreToolUse` guards that return `deny` / `ask`, and a `Stop` hook that returns a follow-up until the gates pass. Rules files still exist, but only for conventions that cannot be checked mechanically, and those are labelled as conventions.

## Consequences

- A runtime without a hook API gets docs with an explicit "not enforced" banner rather than false comfort.
- Every ban in `AGENTS.md` must correspond to a pattern in `.agent-ready/config.json` or be marked "convention".
- The tool needs an adapter per runtime and must track their wire formats; `hooks/lib/protocol.js` is the single place for that.

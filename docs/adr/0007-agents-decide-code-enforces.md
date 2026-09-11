# ADR-0007: Agents decide what, code enforces how

Status: accepted
Date: 2026-09-11

## Context

The first versions generated the agent environment from templates and a regex scanner. The output was generic: `CLAUDE.md` with `TODO` blanks, conventions that were true of every project, domain docs without invariants. The judgement part — what this codebase actually is, what its conventions and landmines are — cannot be templated. Only something that reads the code can produce it.

## Decision

`fenceline init` orchestrates the user's agent runtime (Claude Code first; Cursor, Codex, Gemini as drivers) through phases: a deterministic **evidence** pack, agent **diagnosis** with a JSON-Schema-enforced structure where every claim carries evidence (fanned out per area and synthesized), agent **composition** of the environment files, an independent agent **review** that tries to disprove them, and a **proof** that runs a canary task through the real runtime.

Enforcement stays deterministic: the diagnosis names protected globs, checks, branches and siblings; code converts them into hook configuration and installs the hooks. Agents never write `.fenceline/config.json` or the hook scripts.

## Consequences

- Runs cost money and minutes (budget-capped per phase); a `--agent none` template mode remains for repos without an agent CLI or API access.
- Quality depends on the runtime's reading; the critic pass and the "open questions" list make the residual uncertainty visible instead of hiding it in confident prose.
- Diagnosis agents are read-only; the compose agent may write only environment files; the review agent only what compose wrote. Source code is never touched by the pipeline.
- The fake runner keeps the contract testable without an API: a path the fixture diagnosis protects must be denied by the installed hooks.

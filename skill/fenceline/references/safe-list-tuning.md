# Tuning the safe-list: blast radius, not difficulty

The question for every task type is: **if the agent gets this wrong and a reviewer misses it, what does it cost?**

| Cost if wrong | Example | Verdict |
| --- | --- | --- |
| Visible in review in seconds, reversible | copy change, small UI bug, added test | autonomous |
| Visible in review with effort, reversible | new RTK slice, new endpoint over existing data | autonomous **with acceptance criteria** |
| Might not be visible in review; expensive to reverse | auth flow, payments, push, migrations, native config | human-only |
| Invisible until production; irreversible | secrets, deploy scripts, data deletion | hooks deny it |

## Per-stack defaults the presets ship with

- **expo**: native tree, app.config / plugins / eas, push / OAuth / payments / deep links, new offline / socket / auth-guard architecture, store builds / OTA → human. Small UI, copy, utils, docs, narrow offline UI with a path + AC → auto.
- **react-web**: auth, PII, routing architecture, global state, build config, analytics → human.
- **node-api / python**: migrations / schema, auth / permissions / payments, public API contracts, queues / jobs / cron → human. New validation rule or read-only endpoint with a test → auto.
- **go**: migrations, protobuf / gRPC contracts, concurrency model, generated code → human. Pure function with a table-driven test → auto.
- **rust**: `unsafe`, migrations, public crate API, async runtime changes → human. Pure function with a unit test, new error variant → auto.
- **monorepo**: cross-package changes and shared packages → human.
- **base (every preset)**: secrets, CI / deploy, core dependency upgrades, "while we are here" refactors, anything without acceptance criteria → human.

`npx fenceline triage "<task>"` gives a deterministic first opinion from these same signals; use it to sanity-check your tuning.

## Signals to move something from auto to human

- The last two PRs in that area were reverted.
- The reviewer for that area is one person and they're busy.
- The change touches a boundary with another team or repo.

## Signals to move something from human to auto

- Tests cover the behaviour and run in the stop-hook.
- The task shape is repetitive and the acceptance criteria are always the same.
- Three consecutive agent PRs there needed no changes in review.

## The rule at the edge

"When in doubt — don't open a PR, explain." An agent refusal is a normal outcome and a signal to improve the docs, not a failure.

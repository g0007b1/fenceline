# A rule an agent can forget is not a rule

*Why this tool exists, and why it is built around hooks instead of prompts.*

## The failure that repeats

Every team that lets an AI agent write code goes through the same three weeks.

Week one: the agent is impressive. Week two: it edits the native `android/` folder in a managed Expo project, commits a `.env`, "cleans up" four files nobody asked about, and reports "done" with red type-check. Week three: someone writes a long rules file. It helps. Then, twenty tool calls into a session, the agent forgets the rule it read at the start and does the thing again.

That is not a model problem. It is an architecture problem. A rule that lives only in the context window competes with everything else in the context window. Under pressure it loses.

## What worked

In the team this tool comes from — a React Native app, a Node.js API and a Telegram bot that opens pull requests through an agent SDK — the practices converged over a year on a handful of things that did not depend on the agent remembering anything:

1. **The runtime says no.** A pre-tool hook that returns `deny` for protected paths and destructive commands. The agent cannot argue with it; it can only describe what it wanted to do.
2. **The runtime says not yet.** A stop hook that refuses to end the turn until lint and type-check are green, the agent has re-read its own diff against the rules, and the answer ends with a test plan. Red lint stops reaching reviewers.
3. **One document per audience.** People need onboarding, analysts need a way to write executable tasks, agents need an operating manual, the IDE needs conventions. A single README for all of them goes stale for all of them at once.
4. **A safe-list by blast radius.** The agent *can* write the payment flow. The question is what it costs when it is wrong and the reviewer is tired. Small UI fixes with acceptance criteria: automatic. Payments, auth, migrations, native config: a human.
5. **Domain docs only where things break.** Git history knows where: the directories with the most bug-fix commits and the most authors. Those get a living map — code map, invariants, current facts, known gaps. Nothing else does; empty docs are noise.
6. **Neighbouring repositories are read-only.** A disagreement between the task and the backend becomes a handoff file, not a silent workaround.

Once those were in place, tasks like *"remove the header on the bookings table screen"* started shipping as draft PRs without a conversation. Not because the agent got smarter, but because the environment stopped letting it finish badly.

## Why a generator, and why zero dependencies

The enforcement part is mechanical and the same for every stack: patterns, a state machine, wire formats for each runtime. That should be one command, re-runnable, removable, and honest about what it does and does not enforce.

The judgement part — what the product is, what the vocabulary is, what actually breaks in the fragile zones — is not mechanical. The generator leaves it as explicit `TODO` markers and gives an agent a skill for filling them from the code and the git history, which is where that knowledge already lives.

Hooks run on every tool call, so they have to start in milliseconds and must never break because of a dependency upgrade. Two hundred lines of dependency-free Node is a feature, not a limitation.

## What this is not

Not a readiness score. Not a rules marketplace. Not a sandbox — a determined agent with shell access can still do harm that no regex catches, which is why the safe-list and human review remain part of the design. The hooks remove the *accidental* failures, which in practice were nearly all of them.

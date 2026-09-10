---
name: fenceline
description: Make a repository safe and productive for AI coding agents — install enforced hooks (lint / type-check gates, protected paths, destructive-command guards), a safe-list of tasks agents may ship alone, layered docs (AGENTS.md / CLAUDE.md / rules / domain docs), slash commands, and detect fragile zones from git history. Works for Node, Python, Go, Rust and generic repos; Cursor, Claude Code, Codex. Use whenever the user wants to "set up the project for agents", "add AI practices", "make Cursor / Claude Code follow our conventions", "bootstrap AGENTS.md / CLAUDE.md / cursor rules / hooks", "stop the agent from touching X", copy practices from another repo, or asks why agents keep breaking conventions — even if they don't say "fenceline". Also use it to refresh an existing setup after the stack or conventions changed.
---

# fenceline

You are setting up (or refreshing) a repository so that autonomous coding agents work in it the way the team does — and cannot break the rules that matter. The tool does the deterministic part (hooks, config, templates); you do the judgement part (understanding the product, filling the docs, tuning the safe-list).

The principle you are installing: **a rule an agent can forget is not a rule. Enforce in the environment, not in the prompt.**

## Workflow

### 1. Scan first, touch nothing

```bash
npx fenceline scan
npx fenceline scan --json > /tmp/fenceline-profile.json
```

Read the profile. Note: preset, checks (lint / type-check / test commands), risk zones (payments, auth, push, migrations, native, secrets, jobs…), fragile zones (high-churn dirs with many bug-fix commits), sibling repos, existing agent docs, warnings.

If `existingAgentDocs` is non-empty, read those files before anything else. They are the team's current conventions; the goal is to enforce them, not replace them.

### 2. Interview — five questions, no more

Ask only what the scan cannot know. Skip any question the scan or the conversation already answered.

1. **Audiences.** Who will read the docs: engineers only, or also analysts / PMs writing tasks for agents? (Decides how much goes into CLAUDE.md.)
2. **Hard bans.** Anything an agent must never touch that the scan didn't flag? (Confirm the detected risk zones; add theirs.)
3. **Siblings.** Are the detected sibling repos really read-only for this repo, or should some be ignored?
4. **PR policy.** Base branch, branch prefix, draft vs ready by default.
5. **Fragile zones.** For each detected zone: "what breaks there?" — one sentence each. If they don't know, leave the TODO and say so.

If the user already gave you a source of practices (another repo's docs, an export folder), read it now and treat it as the answer to most of these.

### 3. Init

```bash
npx fenceline init -y --runtime <cursor,claude,codex,gemini,copilot> [--profile strict|balanced|light] [--only hooks,rules,commands,docs,domain-docs,templates] [--preset <id>] [--siblings ../a,../b] [--protected-branches a,b] [--base-branch <b>] [--branch-prefix <p>] [--require-tests]
```

Use `-y` (you are not a terminal user; the wizard would wait for input) and pass the answers from the interview as flags. Use every runtime the team uses. Read the report; every line is a file you now own. Later tweaks: `npx fenceline config set <key> <value>`.

### 4. Fill the judgement parts

The generator leaves `TODO(fenceline)` markers and skeleton domain docs on purpose — the tool cannot know the product. You can. Fill, in this order:

- **CLAUDE.md → "What this project is"**: 2–4 sentences from README, the manifest, the code. What it does, who uses it, what "production" means.
- **CLAUDE.md → "Key entities and vocabulary"**: 5–15 nouns that recur across the code (model / type / schema names, screen names, domain terms), where each lives, and synonyms *not* to use. Get these from types / models / schemas, not from guessing.
- **docs/<zone>.md for each fragile zone**: use `/fenceline-domain-doc <dir>` or do it by hand — read the code in that directory and the last 20–40 commits touching it (`git log --oneline -- <dir>`). Fill "Code map", "Do not break" (invariants — past bug fixes tell you what they are), "Current facts", "Known gaps". Do **not** invent; leave `<!-- TODO: confirm with team -->` where the history is silent.
- **docs/agent-safe-tasks.md**: add project-specific entries below the managed block. Move anything the user named in the interview to the right side.
- **AGENTS.md** below the managed block: project-specific rituals (how to run the app, what the PR body needs beyond the template, ticket linking if any).
- **Rules** (`fenceline-*` in the runtime's rules dir): edit the stack rule to match real conventions you saw in the code (alias names, component folder shape, theme hook name, module layout). Concrete beats generic.

Rules of thumb while filling:

- **Lazy docs.** Do not create domain docs for directories the scan did not flag unless the user asks. Empty docs are noise.
- **Every ban must be enforceable or explicit.** If you add "never touch X" to AGENTS.md, either add the path to `.fenceline/config.json → denyWrite` (then `npx fenceline doctor`) or mark it "convention, not enforced".
- **Numbers over adjectives** in domain docs: "list can reach 5k rows" beats "large list".

### 5. Verify

```bash
npx fenceline check     # hooks wired, checks runnable, docs present, TODOs left
npx fenceline doctor    # dry-run the guards + simulate a session through the stop-hook
```

If `check` warns that lint or type-check commands are missing, propose adding them (`"type-check": "tsc --noEmit"`, `ruff`, `mypy`, `go vet`, `cargo clippy`) — without them the stop-hook has nothing to enforce. Do not silently skip this; it is the single most important gate.

### 6. Prove it

Perform one trivial safe-list task yourself in the runtime the team uses (fix a typo in a string) and confirm you were stopped until the checks ran and were asked for a "How to test" section. Report what happened. If a hook did not fire, read `references/hooks-protocol.md` before changing the config.

### 7. Report

End with a short summary the user can paste into a PR description:

- what was installed (hooks, rules, commands, docs) and for which runtimes;
- what is enforced vs. what is convention only;
- which TODOs remain and who should fill them;
- one line on how to refresh (`npx fenceline refresh` after stack / convention changes) and how to remove (`npx fenceline uninstall`).

## When refreshing an existing setup

- `npx fenceline refresh` updates only managed blocks, hooks, rules and commands; human text stays.
- Re-run `scan` first and diff `.fenceline/profile.json` against the previous one: new risk deps or new fragile zones are the reason to touch the docs.
- Never overwrite a doc that has no markers unless the user explicitly says `--force`.

## Reference files

- `references/hooks-protocol.md` — what each hook does, runtime I/O formats, how to add a custom guard.
- `references/writing-domain-docs.md` — how to turn git history and code into a useful domain doc, with a worked example.
- `references/safe-list-tuning.md` — how to decide autonomous vs human-only using blast radius, with examples per stack.

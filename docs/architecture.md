# Architecture

```
bin/fenceline.js        CLI: init (orchestrator) | task | diagnose | refresh | scan | check | doctor | triage | config | runtimes | presets | skill | uninstall
src/orchestrator/
  runners/              drive an agent CLI non-interactively: claude (verified) · cursor · codex · gemini (experimental) · fake (tests)
  evidence.js           deterministic evidence pack (scan + tree + churn + manifests + existing docs) → .fenceline/evidence.{json,md}
  prompts/*.md          diagnose · synthesize · compose · review · canary · task — the product lives here
  schemas/*.json        JSON Schemas the agents' answers must satisfy (diagnosis: every claim with evidence; task: summary + how-to-test)
  pipeline.js           evidence → diagnose (fan-out + synthesis) → enforce → compose → review → prove; budget/turn caps per phase
  enforce.js            diagnosis → .fenceline/config.json + hooks + runtime hook configs (agents decide what, code enforces how)
  prove.js              doctor + canary task through the real runtime with hooks live
  verify.js             deterministic checks on a diagnosis / written docs: cited paths, commits and scripts must exist; duplicates merged
  task.js               `fenceline task`: triage → branch → agent with hooks live → baseline-aware checks → commit → draft PR
src/
  scan.js                 walks the repo → profile.json (stack, checks, risks, fragile zones, siblings, warnings)
  detectors/              one file per ecosystem: node · python · go · rust · generic (Makefile / justfile / Taskfile)
  risks.js                RISK_SIGNALS: dependency names (any ecosystem) + path patterns → human-only zones
  fragile.js              git log → churn / bug-fix / author score per directory → fragile zones
  presets.js              loads presets/<id>/preset.js, merges with presets/_base, resolves rule files
  init.js                 profile + preset → .fenceline/config.json, hooks, rules, commands, managed docs
  render.js               {{var}} rendering + <!-- fenceline:managed --> block merging
  check.js · doctor.js · triage.js · uninstall.js · skill.js
  adapters/               cursor.js · claude.js · codex.js · gemini.js · copilot.js — the only place runtime file layouts live
presets/
  _base/                  the layer every preset extends: secrets, git safety, scope, docs-sync, testing rules
  <id>/preset.js          data only: denyWrite, denyShell, rules, safe-list entries, hard bans, triage words, doctor samples
  <id>/rules/*.mdc        conventions, written to each runtime's rules dir (frontmatter converted per runtime)
hooks/                    the seven scripts copied into target repos; lib/protocol.js hides runtime I/O differences,
                          lib/shell.js is the quote-aware command reader, lib/patterns.js the path classifier
templates/                AGENTS / CLAUDE / safe-list / docs index / domain doc / handoff / ADR / slash commands
skill/fenceline/        SKILL.md + references — the procedure an agent follows to finish the setup
test/run.js               end-to-end tests over throwaway repos (expo + sibling, python, next+prisma, go workspace, generic) incl. every known bypass
```

## Data flow

0. `init` with an agent: `src/orchestrator/pipeline.js` — see ADR-0007. Everything below is the deterministic substrate it uses (evidence, enforcement) and the `--agent none` fallback.
1. `scan` never writes. It produces a JSON profile that everything else consumes — the CLI, the templates, `triage`, the skill.
2. `init` = scan → choose preset → build config → copy hooks → write per-runtime hook config, rules and commands → write managed docs. Every step is idempotent.
3. Hooks read `.fenceline/config.json` on every call and keep per-session state in `.fenceline/state/<id>.json`; denies and asks go to `.fenceline/audit.log`. No daemon, no cache. An unparsable config denies everything.
4. `task` writes `.fenceline/state/baseline.json` (which checks already fail on the base and with which error lines) before the agent starts; the stop hook and the post-run check compare against it, so only *new* errors block. The agent never commits: fenceline commits from its working tree and opens the draft PR, so the branch shape is deterministic.
5. `doctor` runs the real hook scripts with synthetic payloads (preset samples + this repo's siblings and checks) and drives a full session through the stop-hook on a scratch state file.

## Design choices

- **Zero dependencies.** Hooks run on every tool call; they must start in milliseconds and never break on `npm install`.
- **Config is data.** Presets and the generated config are JSON-serialisable. Regexes are stored as `{source, flags}`.
- **Namespaced output.** Everything written is under `.fenceline/`, prefixed `fenceline-`, merged into an existing hook config, or inside managed markers. `uninstall` is the exact inverse.
- **Fail closed for writes, bounded for stops.** A write guard that cannot determine the path denies. A stop hook that cannot get green gives up after `maxStopAttempts` and says so.
- **One hook implementation, N runtimes.** `hooks/lib/protocol.js` normalises input (`tool_input.file_path` vs `path` vs `target_file`…) and output (`permission` vs `hookSpecificOutput`…). The runtime is passed as `--runtime` argv so the generated commands work on Windows.
- **Enforcement is honest.** Adapters wired from vendor docs but not yet verified in a live session are labelled experimental in README and in the generated AGENTS.md; a runtime without a hook API would get a banner saying nothing is enforced, never a false sense of safety.

## Extending

| Want to… | Touch |
| --- | --- |
| add a stack | `presets/<id>/preset.js` (+ `rules/*.mdc`), `choosePreset()` in `src/presets.js`, a detector if the manifest is new |
| add a risk signal | `RISK_SIGNALS` in `src/risks.js` — deps + path patterns + label |
| add a runtime | `src/adapters/<id>.js` (`{ id, label, enforces, rulesPath, ruleExt, commandsPath, writeHooksConfig, removeHooksConfig, isWired, convertRule }`) and, if its wire format is new, `hooks/lib/protocol.js` |
| add a slash command | `templates/commands/fenceline-<name>.md` + `COMMANDS` in `src/init.js` |
| change a gate | `hooks/ensure-checks.js` — and the state machine diagram in `docs/hooks.md` |
| teach the shell guard a new verb | `hooks/guard-shell.js` (`WRITE_LAST` / `WRITE_ALL` / `gitCommand` / `rmCommand`) + a `doctor` sample + a test case |

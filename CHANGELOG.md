# Changelog

## 0.4.0 — you choose what gets installed

- **Interactive `init`** (readline, zero deps): stack preset, which runtimes (only detected ones pre-selected), strictness profile, components, read-only neighbours, base branch / prefix. `-y` or CI → defaults, no questions. `--dry-run` shows the plan.
- **Components**: `hooks`, `rules`, `commands`, `docs`, `domain-docs`, `templates`, `skill` via `--only` / `--skip`. Docs without hooks get an explicit "nothing is enforced" note.
- **Profiles** `strict` / `balanced` / `light` bundle `runChecksOnStop`, `maxStopAttempts`, tests-required, the review / docs-sync **gates** and the **strictness** knobs (`rmRecursive`, `secretsRead`, `inlineScripts`, `gitCheckoutPaths`: deny | ask | allow).
- `--no-review`, `--no-docs-sync`, `--check "<cmd>"`, `--protected-branches`, and **`fenceline config get|set`** for any knob afterwards; `fenceline runtimes` shows what is detected.
- `refresh` reuses the previous answers (runtimes, profile, components, siblings, branches, overridden checks); flags override.

## 0.3.0 — hardening after adversarial review

Every finding of an adversarial review became a regression test. Highlights:

- **Shell guard rewritten around a quote-aware command reader** (`hooks/lib/shell.js`): every write target (redirects, `cp` / `mv` / `tee` / `sed -i` / `rm` …) is expanded (`$VAR`, `~`), resolved through symlinks and `cd` chains, and classified exactly like an edit-tool write. Words inside quotes and heredocs never trigger rules.
- **`git push` is parsed**: refspecs (`HEAD:main`, `+main`, `--mirror`, `--delete`), bare `push` resolved against the current branch, protected names matched as whole refs — `feature/main-page` no longer trips it.
- **Stop hook runs the checks itself** for anything not honestly green; `|| true`, `echo npm run lint` and spoofed state files no longer count. Failing output is quoted back to the agent.
- **Fail-closed on tooling**: `.fenceline/**` and every runtime hook config are protected from edit tools and shell; an unparsable config denies everything.
- **Per-session state** (`.fenceline/state/<id>.json`); `SessionStart(compact|resume)` no longer wipes it. **Audit log** of every deny / ask.
- **`guard-read`**: secrets never enter the agent context; reading them from the shell asks.
- **Runtimes**: Cursor matchers and exit-code source corrected against current docs; Claude Code `SessionStart` matcher, `PowerShell`, `@AGENTS.md` import; **Codex** (hooks + `apply_patch` parsing), **Gemini CLI** and **GitHub Copilot** adapters (experimental).
- **Scanner**: fragile-zone score fixed (was NaN), commit subjects with `|` handled, `.env*` visible to the secrets signal, PEP 621 optional dependencies parsed, primary ecosystem chosen by evidence (Django + Tailwind stays Python), migrations module attached whenever an ORM is detected regardless of preset, monorepo as a layer on top of the language preset.
- Siblings are opt-in (`--siblings`), `.gitignore` entries live in a delimited block, unparsable runtime configs are never overwritten, managed-block corruption is refused, CLI validates its arguments, `/tmp` writable on macOS.
- Repo: SECURITY.md, issue / PR templates, CITATION, ADRs, `docs/why.md`, VHS tape, social preview.

## 0.2.0 — universal core

- **Stack-agnostic core.** Ecosystem detectors for Node, Python (uv / poetry / pipenv / pip), Go, Rust and Makefile / justfile / Taskfile repos. Checks are full shell commands (`uv run ruff check .`, `go vet ./...`, `cargo clippy`), not npm script names.
- **Presets as data directories.** `presets/<id>/preset.js` + `rules/`, all extending `presets/_base`. New presets: `node`, `python`, `go`, `rust`. Expo-specific material lives only in `presets/expo/`.
- **Codex adapter** (docs-only, explicit "not enforced" banner) next to Cursor and Claude Code. Claude Code rules are now path-scoped (`paths:` frontmatter).
- **Slash commands** installed per runtime: `/fenceline-review`, `/fenceline-pr`, `/fenceline-handoff`, `/fenceline-domain-doc`, `/fenceline-triage`.
- **`fenceline triage`** — deterministic auto / needs-ac / human verdict from the repo's own risk zones, protected paths, fragile zones and keyword heuristics; scriptable exit codes.
- **`fenceline doctor`** now also simulates a full session through the stop-hook on a scratch state file, and tests sibling-repo guards for the repo's actual siblings.
- **`fenceline uninstall`** — exact inverse of init; `--docs` strips managed blocks.
- **`fenceline skill`** — installs the skill into `.agents/skills` / `.claude/skills`.
- Hooks: runtime passed as `--runtime` argv (Windows-friendly); sibling repos read-only from the shell with a read-only command allow-list; temp dirs writable; a code edit after review re-arms the gates; richer failure markers for runtimes without exit codes.
- Scanner: risk signals for jobs / queues and outbound email; cross-ecosystem dependency matching; test and docs directories excluded from fragile zones; source paths preferred over test paths as evidence.
- Docs: ADR template, "Task intake" section in AGENTS.md, "How to ask for a change" in CLAUDE.md.

## 0.1.0

- Initial extraction: scan, init / refresh, check, doctor; Cursor + Claude Code adapters; expo / react-web / node-api / monorepo / generic presets; managed-block docs; fragile zones from git churn; the skill.

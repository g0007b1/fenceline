# Hooks: what runs when, and the wire format

Seven scripts live in `.agent-ready/hooks/` inside the target repo (copied on `init`) and read `.agent-ready/config.json` on every call. Session state is in `.agent-ready/state/<session>.json`; every deny / ask is appended to `.agent-ready/audit.log` (both gitignored). The runtime is passed as `--runtime <id>`.

| Script | Cursor | Claude Code | Codex | Gemini CLI | Copilot | Purpose |
| --- | --- | --- | --- | --- | --- | --- |
| `session-start.js` | `sessionStart` (agent mode) | `SessionStart` (startup\|clear\|resume\|compact) | `SessionStart` | `SessionStart` | `sessionStart` | Injects the gates; resets state only for startup / clear |
| `guard-write.js` | `preToolUse` Write\|Delete, failClosed | `PreToolUse` Write\|Edit\|NotebookEdit | `PreToolUse` apply_patch\|Edit\|Write | `BeforeTool` write_file\|replace | `preToolUse` | Denies protected / tooling / sibling / outside paths; resolves symlinks; parses `apply_patch` |
| `guard-read.js` | `beforeReadFile` | `PreToolUse` Read | `PreToolUse` Read | `BeforeTool` read_file | `preToolUse` | Secrets never enter the context |
| `guard-shell.js` | `beforeShellExecution`, failClosed | `PreToolUse` Bash\|PowerShell | `PreToolUse` shell | `BeforeTool` run_shell_command | `preToolUse` | Command parsing — see below |
| `track-edit.js` | `afterFileEdit` | `PostToolUse` edit tools | `PostToolUse` | `AfterTool` | `postToolUse` | Records edited files; invalidates checks + review; integration triggers |
| `track-checks.js` | `afterShellExecution` + `postToolUse` Shell | `PostToolUse` Bash\|PowerShell | `PostToolUse` shell | `AfterTool` | `postToolUse` | Records honest check runs |
| `ensure-checks.js` | `stop` (loop_limit) | `Stop` | `Stop` | `AfterAgent` | `agentStop` | Runs checks → review → docs sync |

## What guard-shell understands

`hooks/lib/shell.js` splits a command line into pipelines and segments outside quotes, drops heredoc bodies and comments, strips `VAR=x` / `command` / `exec` / `(` prefixes, extracts redirections, and produces a *masked* form where quoted content is replaced by `"…"`. Then, per segment, with a virtual cwd that follows `cd` / `pushd` and a variable table that follows `X=…` assignments:

- **Writes**: redirect targets; last argument of `cp` / `mv` / `rsync` / `install` / `ln` / `scp`; all arguments of `tee` / `touch` / `mkdir` / `truncate` / `chmod` / `chown` / `patch`; `sed -i` / `perl -pi` file arguments; `rm` targets. Each is expanded (`$VAR`, `~`, `$PWD`), resolved through symlinks, made repo-relative and classified: tooling → sibling → protected → outside-repo (temp dirs are fine). Any hit → **deny**.
- **git**: global options (`-c`, `-C`, `--no-pager`) skipped; `-C dir` changes the directory. `push`: `--force` / `-f` / `+ref` / `--mirror` → deny; `--force-with-lease` → ask; each refspec's destination (`src:dst`, `refs/heads/` stripped, `HEAD` and bare push resolved via `git symbolic-ref`) checked against `protectedBranches`; `--delete` of a protected branch → deny, otherwise ask. `reset --hard`, `clean -f`, `stash drop|clear`, `filter-branch`, `update-ref -d`, `reflog expire`, renaming / deleting a protected branch → deny. `checkout -- …`, `checkout .`, `restore` (without `--staged`), `branch -D`, `rm -r`, `gc --prune` → ask. `add` / `commit` / `rm` / `mv` naming a secrets file → deny; `add -A` / `add .` / `commit -a` with an untracked secret (from `git status --porcelain`) → deny. Any write subcommand while the virtual cwd is inside a sibling → deny.
- **rm**: flags normalised (`-rf`, `-r -f`, `--recursive`); recursive delete of `/`, `~`, `..`, `.`, `*`, the repo root or its parent → deny; recursive elsewhere → ask; targets classified like writes.
- **Others**: `sudo` / `doas` / `su` / `pkexec` → deny. `curl | sh` (any downloader piped into any interpreter) → deny. `chmod 777` / `a+rwx` / `o+w` → deny. `find -delete` / `-exec rm` → ask. `dd of=/dev/…`, `mkfs`, fork bomb, `kill -1` → deny. DB clients with `drop` / `truncate` / `delete from` in the statement → deny.
- **Interpreters**: `node -e`, `python -c`, `sh -c`, `eval`, `perl -e`, … whose text mentions a protected / sibling / tooling path → **ask** ("do file edits through the edit tool so they can be checked").
- **Reading secrets**: `cat` / `grep` / `source` / `head` / … of a `denyRead` path → ask. `.env.example` is always fine.
- Finally the preset's `denyShell` rules run against the masked pipeline and each masked segment, so `git commit -m "fix sudo prompt"` never matches a rule about `sudo`.

What it does not do: execute the command in a sandbox, follow `$(…)` substitutions, or reason about scripts on disk (`sh deploy.sh`). See the Limitations section of the README.

## Config keys the hooks read

```jsonc
{
  "profile": "balanced",                                       // strict | balanced | light — the bundle the knobs below came from
  "components": ["hooks", "rules", "commands", "docs", "domain-docs", "templates"],
  "checks": [{ "id": "lint", "command": "npm run lint" }],      // matched loosely: "pnpm lint" counts for "npm run lint"
  "runChecksOnStop": "missing",                                // missing | always | never
  "checkTimeoutMs": 180000,
  "gates": { "review": true, "docsSync": true },              // the two stop-hook nudges after checks are green
  "strictness": { "rmRecursive": "ask", "secretsRead": "ask", "inlineScripts": "ask", "gitCheckoutPaths": "ask" },   // deny | ask | allow
  "denyWrite": [{ "source": "^android/", "flags": "", "label": "android/ (managed by prebuild)" }],
  "denyRead":  [{ "source": "(^|/)\\.env(?!\\.example$)", "flags": "", "label": ".env files" }],
  "denyWriteHint": "…",
  "denyShell": [{ "source": "^terraform\\s+apply", "flags": "", "why": "…", "severity": "deny" | "ask" }],   // matched at command start, masked text
  "integrationTriggers": [{ "source": "^package\\.json$", "flags": "" }],
  "codeFilePattern": null,                                     // null → built-in list of source extensions
  "siblings": ["../backend"],
  "allowOutsideRoot": [],                                      // temp dirs are always allowed
  "protectedBranches": ["main", "master", "develop", "production", "staging", "trunk"],
  "failClosed": true,
  "maxStopAttempts": 4,
  "rulesPath": ".cursor/rules"
}
```

Path patterns are case-insensitive on macOS and Windows. The tooling paths (`.agent-ready/`, `.claude/settings*.json`, `.cursor/hooks.json`, `.codex/hooks.json`, `.gemini/settings.json`, `.github/hooks/`) are always protected regardless of config. A config that exists but does not parse denies every edit and shell command until restored.

## Stop-hook state machine

```
edited anything in this session? ──no──▶ done
     │yes
code edited → for each check not green since the last edit: run it (runChecksOnStop=missing)
     ├─ any red ──▶ followup "these checks fail: <output>"          (attempt +1)
     │no
reviewed? ──no──▶ followup "review changed files + How to test"    (attempt +1, reviewed = true)
     │yes
integration trigger fired && !docsSynced? ──yes──▶ followup "sync README / AGENTS / .env.example — or say why not"  (attempt +1)
     │no
done (state reset)
```

A later code edit resets `checks` and `reviewed`. `maxStopAttempts` bounds the loop. `track-checks` marks a check green only when: the command line contains no `||`, the pipeline head is the check itself (not `echo` / `grep` / `cat`), and the exit code is 0 (or, when the runtime gives no exit code, the output has no failure markers). With `runChecksOnStop: "always"` the stop hook ignores that record and re-runs everything.

## Wire formats

| Runtime | Deny (pre-tool) | Ask | Stop follow-up | Session context |
| --- | --- | --- | --- | --- |
| Cursor | `{ permission: "deny", user_message, agent_message }` | `permission: "ask"` (shell only) | `{ followup_message }` | `{ additional_context }` |
| Claude Code, Codex | `{ hookSpecificOutput: { hookEventName, permissionDecision: "deny", permissionDecisionReason } }` | `permissionDecision: "ask"` | `{ decision: "block", reason }` | `{ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }` |
| Gemini CLI | `{ decision: "deny", reason }` | deny with reason | `{ decision: "block", reason }` | stdout |
| Copilot | `{ permissionDecision: "deny", permissionDecisionReason }` | `permissionDecision: "ask"` | exit 2 + stderr | stdout |

Exit code 2 with the reason on stderr also blocks in Claude Code / Codex. Input fields normalised by `protocol.js`: `tool_input.file_path | path | target_file | notebook_path`, `toolArgs` (Copilot, JSON string or object), `tool_input.command` (shell, or the patch text for Codex `apply_patch`), `session_id | conversation_id` for the state file, `workspace_roots[0] | cwd | CLAUDE_PROJECT_DIR` walked up to the directory containing `.agent-ready/config.json`.

## Adding a custom guard

1. Add a pattern to `.agent-ready/config.json` — `denyWrite` with a `label`, or `denyShell` anchored with `^` and a `why`.
2. `npx agent-ready doctor` — and, if you contribute it upstream, a `doctor` sample in the preset that must hit and one that must not.
3. Mention the ban in `AGENTS.md` "Hard bans" so humans know it exists.

## Debugging a hook by hand

```bash
echo '{"tool_name":"Write","tool_input":{"file_path":".env"}}' | node .agent-ready/hooks/guard-write.js --runtime cursor --root "$PWD"
echo '{"tool_name":"Bash","tool_input":{"command":"git push origin HEAD:main"}}' | node .agent-ready/hooks/guard-shell.js --runtime claude --root "$PWD"
AGENT_READY_STATE_FILE=/tmp/s.json node .agent-ready/hooks/ensure-checks.js --runtime cursor --root "$PWD" < /dev/null
tail -f .agent-ready/audit.log
```

# Hooks: what runs when, and the wire format

Seven scripts live in `.agent-ready/hooks/` inside the target repo (copied on init) and read `.agent-ready/config.json` on every call. Session state is in `.agent-ready/state/<session>.json`, denies/asks in `.agent-ready/audit.log` (gitignored). The runtime is passed as `--runtime cursor|claude|codex|gemini|copilot`. Full reference: `docs/hooks.md` in the agent-ready repo.

| Script | Cursor event | Claude Code event | Purpose |
| --- | --- | --- | --- |
| session-start.js | sessionStart | SessionStart | Injects the gates as context; resets state |
| guard-write.js | preToolUse (Write / Delete) | PreToolUse (Write / Edit / NotebookEdit) | Denies writes to protected paths, the hook config, sibling repos; resolves symlinks |
| guard-read.js | beforeReadFile | PreToolUse (Read) | Secrets never enter the context |
| guard-shell.js | beforeShellExecution | PreToolUse (Bash / PowerShell) | Parses the command: write targets classified like edits, `git push` refspecs, `rm` targets, `sudo`, `curl \| sh`; interpreter one-liners and secret reads ask |
| track-edit.js | afterFileEdit | PostToolUse (edit tools) | Records edited files, invalidates checks + review, detects integration triggers |
| track-checks.js | afterShellExecution | PostToolUse (Bash) | Records which configured checks ran and whether they passed |
| ensure-checks.js | stop (loop_limit) | Stop | Runs the checks itself, then review → docs sync |

## Config the hooks read (`.agent-ready/config.json`)

- `checks`: `[{ "id": "lint", "command": "npm run lint" }]` — full shell commands, matched loosely (`pnpm lint` counts for `npm run lint`).
- `denyWrite` / `denyShell` / `integrationTriggers`: regexes stored as `{ "source", "flags" }`; `denyShell` entries also carry `why` and `severity` (`deny` | `ask`).
- `siblings`: read-only directories, from edit tools and shell.
- `failClosed`, `maxStopAttempts`, `rulesPath`, `allowOutsideRoot`, `codeFilePattern`.

## Stop-hook state machine

```
edited anything? ──no──▶ done
     │yes
code edited && a check not green since last edit? ──yes──▶ followup "run <checks>"   (counts toward maxStopAttempts)
     │no
reviewed? ──no──▶ followup "review changed files + How to test"
     │yes
integration trigger fired && !docsSynced? ──yes──▶ followup "sync README / AGENTS / .env.example — or say why not"
     │no
done (state reset)
```

A later code edit resets `checks` and `reviewed`. `maxStopAttempts` (default 4) bounds the loop so a broken environment cannot trap the agent.

## Wire formats

Cursor (stdin JSON → stdout JSON): pre-hooks `{ permission: allow|deny|ask, user_message, agent_message }`; stop `{ followup_message }`; sessionStart `{ additional_context }`.

Claude Code (stdin JSON → stdout JSON or exit code): PreToolUse `{ hookSpecificOutput: { hookEventName, permissionDecision: deny|ask|allow, permissionDecisionReason } }`; Stop `{ decision: "block", reason }`; SessionStart `{ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }`; non-JSON block = exit 2 + stderr.

`hooks/lib/protocol.js` is the only file that knows these shapes.

## Adding a custom guard

1. Add a pattern to `.agent-ready/config.json` (`denyWrite`: `{ "source": "^infra/", "flags": "" }`; `denyShell`: `{ "source": "terraform\\s+apply", "flags": "", "why": "infra is human-only", "severity": "deny" }`).
2. `npx agent-ready doctor` to confirm.
3. Mention the ban in AGENTS.md "Hard bans" so humans know it exists.

Config is read on every hook invocation — no restart needed.

## If a hook did not fire

- Cursor: hooks only run for the Agent mode; check `.cursor/hooks.json` contains `.agent-ready/hooks/` commands and restart the agent session.
- Claude Code: `.claude/settings.json` must contain the `hooks` block; `/hooks` in the CLI lists what is active. `$CLAUDE_PROJECT_DIR` must resolve — run from the repo root.
- Run the script by hand: `echo '{"tool_name":"Write","tool_input":{"file_path":".env"}}' | node .agent-ready/hooks/guard-write.js --runtime cursor --root "$PWD"`.

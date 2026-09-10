# Security policy

`agent-ready` installs guards that are supposed to stop an AI coding agent from doing damage. A way around a guard is therefore a security issue for everyone who relies on it.

## What counts

- **Guard bypass**: a shell command or an edit-tool payload that performs a forbidden action (force-push, writing a protected path, writing into a sibling repository, `rm -rf` outside scope…) without a `deny` / `ask`.
- **Stop-hook escape**: the agent is released while a configured check is red or has not run since the last code edit.
- **Hook config tampering**: a way for an agent to edit `.agent-ready/config.json`, the hook scripts, or the runtime's hook config through normal tools.
- **Secrets exposure**: the tool itself reading, printing or persisting secret values.

Not in scope: an agent that ignores a *convention* in `AGENTS.md`. Conventions are documented as unenforced on purpose; if you think one should become a hook, open a regular issue.

## How to report

Open a private report via **GitHub → Security → Report a vulnerability** on this repository, or use the "Guard bypass" issue template if the bypass is already public knowledge (for example a new runtime behaviour). Include the exact payload or command, the runtime and version, and your `.agent-ready/config.json` with secrets removed.

You will get an acknowledgement within a few days. Fixes ship as a patch release with a regression case added to `npm test` and to `agent-ready doctor` samples.

## Design notes that matter for reviewers

- Guards are **fail-closed** for writes: an edit whose target path cannot be determined is denied.
- Shell guards match per command **segment** (`&&`, `;`, `|`), after stripping `VAR=x` prefixes, so `true && git push --force` is still caught.
- The hooks and the config are themselves protected paths.
- The stop-hook is **bounded** (`maxStopAttempts`); a runtime with a broken toolchain releases the agent with an explicit message rather than looping. That is a deliberate availability-over-strictness trade-off — see `docs/adr/`.

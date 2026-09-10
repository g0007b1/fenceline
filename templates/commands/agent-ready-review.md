Review every change on the current branch relative to `{{baseBranch}}` and produce a prioritised list of findings. No summary of what the diff obviously does — only problems and concrete fixes.

Steps:

1. Scope: `git fetch origin {{baseBranch}} --quiet` (ignore errors), `git log --oneline {{baseBranch}}..HEAD`, `git diff {{baseBranch}}...HEAD --stat`, `git status --short`. If there are no commits ahead and no local changes, stop and say so.
2. Read the full diff (`git diff {{baseBranch}}...HEAD`; per file if it is over ~2000 lines). Read whole files where the diff alone is misleading (new modules, moved code).
3. Check against: the rules in `{{rulesPath}}/`, `AGENTS.md` hard bans, `docs/agent-safe-tasks.md`, and the domain docs in `docs/` for any fragile zone touched.
4. For each finding: `file:line`, what is wrong, why it matters, how to fix. Severity: blocker / should-fix / nit.
5. Then run the project checks and report their result:

```bash
{{checkCommands}}
```

Output: findings grouped by severity, then "What I would test by hand" (Given / When / Then), then one line: ready to merge / not ready.

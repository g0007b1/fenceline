Open a pull request for the current work, following AGENTS.md.

1. Confirm the branch is not `{{baseBranch}}`. If it is, create `{{branchPrefix}}<short-kebab-slug>` from it first.
2. Run the checks and fix everything they report:

```bash
{{checkCommands}}
```

3. Build the description from the **whole** branch diff (`git log {{baseBranch}}..HEAD`, `git diff {{baseBranch}}...HEAD`, plus uncommitted changes): why > what, 1–3 short bullets. Do not paste the task text.
4. Commit (if needed) with a "why > what" message, push with `-u`.
5. Open a **draft** PR unless the user explicitly asked for ready:

```bash
gh pr create --draft --base {{baseBranch}} --title "<subject line>" --body "$(cat <<'EOF'
## Summary
- …

## Test plan
- [ ] …
EOF
)"
```

The test plan mirrors the "How to test" section of your last answer.
6. Last line of your answer: `PR: <url>`.

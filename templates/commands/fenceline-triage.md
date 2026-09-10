Decide whether this task may be done autonomously or needs a human, before writing any code: `$ARGUMENTS`

1. Run `npx fenceline triage "<the task text>"` and read the verdict and reasons.
2. Read `docs/agent-safe-tasks.md` and the "Hard bans" in `AGENTS.md`.
3. Map the task to concrete files (`rg`, the "Key entities" table in `CLAUDE.md`). Check whether any of them is a protected path or inside a fragile zone (`docs/README.md`).
4. Answer with exactly:
   - **Verdict:** auto / human / needs acceptance criteria
   - **Why:** 2–3 sentences
   - **Files likely touched:** list
   - **Domain docs to read first:** list or "none"
   - **Missing from the task:** what you would need to proceed (or "nothing")

If the verdict is *auto* and the user asked you to implement it, proceed. Otherwise stop here.

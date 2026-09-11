You are working in the repository at the current directory, on branch `{{branch}}` (created from `{{base}}` for this task). Guardrails are live: hooks deny writes to protected paths, log every command, and a stop hook re-runs the project's checks before you may finish.

## Task

{{task}}

## How to work

1. Read `AGENTS.md` first, then the domain doc(s) for the area you touch{{docsHint}}. Follow the conventions there; do not invent new patterns.
2. Make the smallest change that completes the task. Do not refactor unrelated code, do not touch protected paths, do not add dependencies unless the task requires it.
3. Run the checks yourself before finishing: {{checks}}. Fix what they report.
4. Do NOT run `git commit`, `git push`, `git checkout` or `git branch` — fenceline commits and opens the PR from your working tree.
5. If the task is impossible, unsafe, or needs a decision only the team can make, stop and say so in `blockers` instead of guessing.
6. When done, produce the structured answer: `summary` (what changed and why, 3–8 lines, past tense), `howToTest` (numbered steps a reviewer can follow, concrete commands / URLs / inputs, expected results), `filesChanged`, `checksRun` (each command you ran and whether it passed), `blockers`, `openQuestions`.

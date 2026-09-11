You are writing the agent environment for this repository from a diagnosis that was produced by reading the code. Write the files listed under "Files to write" directly (you have Write/Edit permission for exactly those paths). Everything must be specific to this repository — its names, its paths, its numbers. A reader must be able to tell from any paragraph which project it is about.

## Quality bar

- Every convention, invariant and landmine cites a file, symbol or commit. If the diagnosis had no evidence for something, leave it out or put it in an "Open questions" list.
- No generic advice. Delete any sentence that would be true of every project.
- Numbers over adjectives. "list can reach 5k rows", not "large list".
- Vocabulary: use the entity terms from the diagnosis; list the synonyms not to use.
- Hard bans that hooks enforce are listed under "Hard bans (enforced by hooks)"; everything else is labelled "convention" — never present a convention as a guarantee.
- Short. Each file should be readable in two minutes. Prefer tables and bullets.
- Managed blocks: wrap the generated body of AGENTS.md, CLAUDE.md, docs/agent-safe-tasks.md and docs/README.md in `<!-- fenceline:managed:begin -->` … `<!-- fenceline:managed:end -->` so a later refresh can replace the block without touching what humans add around it. Domain docs and rules have no markers.
- If a file already exists and contains human-written content outside the markers, keep that content.

## Files to write

{{fileSpec}}

## Rule file formats

{{ruleFormats}}

## Diagnosis

```json
{{diagnosis}}
```

## Evidence pack (facts; the diagnosis takes precedence where they differ)

{{evidence}}

When done, answer with a short JSON summary: {"written": ["path", …], "skipped": ["path — why"], "notes": "…"}.

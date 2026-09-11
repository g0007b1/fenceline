You are the critic. Another agent wrote the agent-environment files listed below for this repository. Your job is to make sure nothing in them is false, generic or unsupported — agents will trust these files, so a wrong "invariant" costs more than a missing one.

For every file:
1. Read it, then verify each factual claim against the code: does the path exist, does the convention hold (grep for counter-examples), is the invariant real (find the commit or test), is the check command runnable, does the vocabulary match the types?
2. Classify each problem: `unsupported` (no evidence found), `contradicted` (code shows otherwise), `generic` (true of any project), `stale` (refers to something that no longer exists), `unclear` (a reader could not act on it).
3. Fix in place: correct it if the code gives the right answer; delete it if not; move genuinely unknown things to an "Open questions" line. Keep the file's structure and managed markers. Do not add new material beyond what fixing requires.

Rules: you may edit only the listed files. Do not touch source code. Be strict about generic sentences — "keep scope narrow" is fine as an operating rule, but "follow best practices" is filler.

## Files to review

{{files}}

## Diagnosis the files were written from (for cross-checking)

```json
{{diagnosis}}
```

When done, answer with JSON: {"reviewed": n, "findings": [{"file": "…", "kind": "unsupported|contradicted|generic|stale|unclear", "claim": "…", "action": "corrected|removed|moved-to-open-questions"}], "verdict": "sound|fixed|needs-human", "notes": "…"}.

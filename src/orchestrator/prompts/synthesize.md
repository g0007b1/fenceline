Several agents diagnosed different areas of the same repository in parallel. Merge their partial diagnoses into one consistent whole with the same structure.

Rules:
- Keep every claim that has evidence; drop duplicates; when two partials disagree, open the code and decide, or move the point to `openQuestions`.
- Project-level fields (`project`, `architecture.overview`, `dataFlow`, `checks`, `protectedBranches`, `siblingRepos`, `safeTasks`) must be written once, from the whole.
- Entities: unify spelling and merge `where` lists. Conventions: merge identical rules, keep the weakest honest `strength`.
- Protected paths and risk areas: union, de-duplicated, still precise.
- Do not add anything the partials or the code do not support.

## Partial diagnoses

{{partials}}

## Evidence pack (for reference)

{{evidence}}

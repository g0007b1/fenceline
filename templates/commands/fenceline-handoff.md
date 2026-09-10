The task, the design, or the spec disagrees with what a sibling repository or an external API actually does. Do not work around it and do not edit the sibling — write a handoff.

1. Establish the facts with read-only commands only (`cat`, `rg`, `git log` / `git show` in the sibling). Quote file paths, endpoint names, field names, an example payload.
2. Create `docs/handoffs/<YYYY-MM-DD>-<slug>.md` from `docs/handoffs/_TEMPLATE.md`. One file per problem.
3. Fill: what the task says, what the code / API actually does, impact if unresolved, a proposed resolution marked "not applied — needs the owner's decision".
4. In your answer: two sentences on the mismatch, the handoff path, and what you did **not** implement because of it. Continue with the parts of the task that do not depend on the mismatch.

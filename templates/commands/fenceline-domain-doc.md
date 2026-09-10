Fill or refresh the domain doc for a fragile zone: `$ARGUMENTS` (a directory such as `src/features/booking`; if empty, list `docs/*.md` files that still contain `TODO(fenceline)` and pick the first).

Sources, in this order — do not invent anything:

1. `git log --oneline -40 -- <dir>` — every "fix" commit is a candidate invariant. "fix: double booking when slots overlap" → *a slot cannot be booked twice; the overlap check lives in X*.
2. The tests in or near the directory — each test name is a stated expectation; keep the ones that encode business rules.
3. The types / schemas / enums — that is the vocabulary; list it.
4. The code itself — for the "Code map": the 3–8 files that matter, one line each on what it owns.

Write into `docs/<zone>.md` (create from the template if missing):

- **Code map** — files and what each owns.
- **Do not break** — invariants, in the form "X must always …" / "Y is the only place that …".
- **Current facts** — how it works today, with numbers (limits, timeouts, sizes) over adjectives.
- **Known gaps / backlog** — what is knowingly imperfect, so nobody "fixes" it by accident.

Where the history does not reveal an invariant, leave `<!-- TODO: confirm with team: … -->` rather than guessing. Add the doc to the table in `docs/README.md` and, if the zone has vocabulary, to "Key entities" in `CLAUDE.md`. Report what you filled and what remains open.

# Contributing

Thanks for looking. The bar for a change here is the same one the tool sets for agents: narrow scope, checks green, a way to test it.

## Run the tests

```bash
npm test
```

`test/run.js` builds throwaway repositories (Expo app with a sibling backend, Python service, Go service, Makefile-only repo), runs every CLI command against them and drives the hooks with synthetic payloads. No framework, no mocks, ~5 seconds.

## Where things go

| Change | Files |
| --- | --- |
| New stack preset | `presets/<id>/preset.js` (data only) + `presets/<id>/rules/*.mdc`; `choosePreset()` in `src/presets.js`; a detector in `src/detectors/` only if the manifest is new. Add a `doctor` block with deny / allow samples and a case in `test/run.js`. |
| New risk signal | `RISK_SIGNALS` in `src/risks.js`: dependency names for every ecosystem you can, path patterns, label. |
| New runtime | `src/adapters/<id>.js`, and `hooks/lib/protocol.js` if the wire format is new. That file is the only place runtime differences are allowed. |
| New slash command | `templates/commands/agent-ready-<name>.md` + the `COMMANDS` list in `src/init.js`. |
| Hook behaviour | `hooks/*.js`. Keep them dependency-free and fast — they run on every tool call. Update the state machine in `docs/hooks.md`. |

## Rules of the house

- Zero runtime dependencies. If you need a parser, write the twenty lines.
- Everything the tool writes into a user's repo must be namespaced, merged, or inside managed markers — `uninstall` has to stay an exact inverse.
- A ban that cannot be enforced by a hook is documented as "convention", never presented as a guarantee.
- Every guard rule is tested by `doctor` samples (`denyShell` / `askShell` / `allowShell`, `denyPaths` / `allowPaths`). If you add a pattern, add a sample that hits it and one that must not, and a case in `test/run.js`.
- Shell-guard changes: run the bypass list in `test/run.js` in your head first — quotes, heredocs, `cd` chains, `$VAR`, symlinks, refspecs.
- Pull requests: draft first, with a "How to test" section. Yes, really.

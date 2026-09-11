#!/usr/bin/env node
'use strict';
// stop / Stop: the agent thinks it is done. Send it back until:
//   1. every configured check is green after the last code edit — checks the agent did not run
//      (or ran dishonestly) are executed here, so the verdict is authoritative;
//   2. the changed files were reviewed against the project rules (+ "How to test" section);
//   3. docs were synced if an integration-level file was touched.
// Bounded by maxStopAttempts so a broken toolchain cannot trap the agent forever.
const { spawnSync } = require('child_process');
const P = require('./lib/protocol');
const S = require('./lib/state');
const { codeFileRegExp } = require('./lib/patterns');

const input = P.readStdin();
const runtime = P.detectRuntime(input);
const root = P.realRoot(P.projectRoot(input));
const cfg = S.loadConfig(root);
const session = P.sessionId(input);
if (cfg.corrupt) P.followup(runtime, `fenceline: ${cfg.corruptReason}. Restore .fenceline/config.json (git checkout -- .fenceline/config.json) before finishing.`);
if (input.status && input.status !== 'completed') P.done(); // Cursor: aborted / errored turns are not "done"
const state = S.load(root, session);
const max = cfg.maxStopAttempts || 4;

if (state.editedFiles.length === 0) { S.reset(root, session); P.done(); }
if (state.stopAttempts >= max) { S.reset(root, session); P.done(); }

const codeEdited = state.editedFiles.some((f) => codeFileRegExp(cfg).test(f));
const MAX_OUT = 3500;
const failures = [];
const baseline = S.baseline(root);
if (codeEdited) {
  for (const c of cfg.checks || []) {
    const mode = cfg.runChecksOnStop || 'missing';
    const needRun = mode === 'always' || (mode === 'missing' && state.checks[c.id] !== 'green');
    if (!needRun) continue;
    if (mode === 'never') { if (state.checks[c.id] !== 'green') failures.push({ c, out: '(not run since the last edit)' }); continue; }
    const r = spawnSync(c.command, { cwd: root, shell: true, encoding: 'utf8', timeout: cfg.checkTimeoutMs || 180000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
    if (r.status === 0) { state.checks[c.id] = 'green'; continue; }
    let out = `${r.stdout || ''}${r.stderr || ''}`.trim();
    // failing exactly as it did before the agent touched anything (fenceline task baseline) → not this agent's problem
    const base = baseline && baseline.checks[c.id];
    if (base && base.failing) {
      const fresh = S.errorLines(out).filter((l) => !base.errorLines.includes(l));
      if (!fresh.length) { state.checks[c.id] = 'green'; continue; }
      out = `(new errors since the baseline — the pre-existing ${base.errorLines.length} are not yours to fix)\n${fresh.join('\n')}`;
    }
    failures.push({ c, out: (out.length > MAX_OUT ? out.slice(-MAX_OUT) + '\n…(truncated)' : out) || `(exit ${r.status === null ? 'timeout' : r.status})` });
    state.checks[c.id] = 'red';
  }
}

let message = null;
if (failures.length) {
  message = `fenceline: you edited code and these checks fail:\n\n${failures.map((f) => `### ${f.c.command}  (${f.c.id})\n\`\`\`\n${f.out}\n\`\`\``).join('\n\n')}\n\nFix what they report, run them again, then finish.`;
} else if (!state.reviewed && (!cfg.gates || cfg.gates.review !== false)) {
  state.reviewed = true;
  const list = state.editedFiles.slice(0, 40).map((f) => `- ${f}`).join('\n');
  message = `fenceline: checks are green. Before finishing, review ONLY these changed files against the project rules (${cfg.rulesPath || 'rules'} / AGENTS.md) and fix violations without widening scope:\n${list}\nIf there is nothing to fix, say so explicitly. Then end your answer with a "How to test" section (automated tests, manual steps as Given/When/Then, edge cases).`;
} else if (state.integrationTriggers.length && !state.docsSynced && (!cfg.gates || cfg.gates.docsSync !== false)) {
  state.docsSynced = true;
  message = `fenceline: this change touched integration-level files (${state.integrationTriggers.join(', ')}). Update README / AGENTS.md / CLAUDE.md / .env.example accordingly in this same change — or state explicitly why no docs change is needed — before finishing.`;
}

if (message) {
  state.stopAttempts += 1;
  S.save(root, session, state);
  P.followup(runtime, message);
}
S.reset(root, session);
P.done();

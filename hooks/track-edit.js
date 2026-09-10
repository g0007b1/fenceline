#!/usr/bin/env node
'use strict';
// afterFileEdit / PostToolUse (edit tools): remember what changed; detect "integration-level" edits
// (dependencies, env example, build/CI config) so the stop-hook can demand a docs sync.
const P = require('./lib/protocol');
const S = require('./lib/state');
const { toRegExps, codeFileRegExp } = require('./lib/patterns');

const input = P.readStdin();
if (!P.isEditTool(input)) P.done();
const root = P.realRoot(P.projectRoot(input));
const cfg = S.loadConfig(root);
if (cfg.corrupt) P.done();
const session = P.sessionId(input);
const state = S.load(root, session);
let changed = false;
for (const target of P.editedPaths(input)) {
  const rel = P.relativeToRoot(root, P.realResolve(root, target));
  if (!rel || rel.startsWith('../') || rel.startsWith('.fenceline/')) continue;
  if (!state.editedFiles.includes(rel)) state.editedFiles.push(rel);
  // Any code edit invalidates previously green checks and the self-review.
  if (codeFileRegExp(cfg).test(rel)) { state.checks = {}; state.reviewed = false; }
  for (const re of toRegExps(cfg.integrationTriggers)) if (re.test(rel) && !state.integrationTriggers.includes(rel)) state.integrationTriggers.push(rel);
  changed = true;
}
if (changed) S.save(root, session, state);
P.done();

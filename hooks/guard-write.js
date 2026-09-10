#!/usr/bin/env node
'use strict';
// preToolUse / PreToolUse (edit tools): deny writes to protected paths, the hook machinery itself,
// sibling repositories and anything outside the repo. Symlinks are resolved. Fail-closed: if the
// target cannot be determined, or the config cannot be read, deny.
const P = require('./lib/protocol');
const { loadConfig } = require('./lib/state');
const { toRegExps, classify } = require('./lib/patterns');

const input = P.readStdin();
const runtime = P.detectRuntime(input);
if (!P.isEditTool(input)) P.allow();

const root = P.realRoot(P.projectRoot(input));
const cfg = loadConfig(root);
if (cfg.corrupt) P.deny(runtime, `fenceline: ${cfg.corruptReason}. Refusing all edits until the config is restored (fail-closed).`, 'PreToolUse', { root, tool: P.toolName(input) });

const targets = P.editedPaths(input);
if (!targets.length) {
  if (cfg.failClosed === false) P.allow();
  P.deny(runtime, 'fenceline: could not determine the target path of this edit; refusing (fail-closed). If this tool is legitimate, set "failClosed": false in .fenceline/config.json.', 'PreToolUse', { root, tool: P.toolName(input) });
}

const ctx = { root, denyWrite: toRegExps(cfg.denyWrite), denyRead: toRegExps(cfg.denyRead), isInsideTmp: P.isInsideTmp };
for (const target of targets) {
  const abs = P.realResolve(root, target);
  const rel = P.relativeToRoot(root, abs);
  const hit = classify(cfg, rel, abs, ctx);
  if (hit) P.deny(runtime, `fenceline: "${rel}" — ${hit.why}.`, 'PreToolUse', { root, tool: P.toolName(input), path: rel, kind: hit.kind });
}
P.allow();

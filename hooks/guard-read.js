#!/usr/bin/env node
'use strict';
// beforeReadFile / PreToolUse (Read): secrets never enter the agent's context. `.env.example` is fine.
const P = require('./lib/protocol');
const { loadConfig } = require('./lib/state');
const { toRegExps, isSecret } = require('./lib/patterns');

const input = P.readStdin();
const runtime = P.detectRuntime(input);
if (!P.isReadTool(input)) P.allow();
const root = P.realRoot(P.projectRoot(input));
const cfg = loadConfig(root);
if (cfg.corrupt) P.allow(); // reading is not where the damage happens; guard-write / guard-shell fail closed
const target = P.readPath(input);
if (!target) P.allow();
const abs = P.realResolve(root, target);
const rel = P.relativeToRoot(root, abs);
const ctx = { denyRead: toRegExps(cfg.denyRead) };
if (isSecret(ctx, rel)) {
  P.deny(runtime, `fenceline: "${rel}" holds secrets and is not read into the agent context. Use .env.example / the settings module to learn variable names.`, 'PreToolUse', { root, tool: P.toolName(input), path: rel, kind: 'secret-read' });
}
P.allow();

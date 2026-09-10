#!/usr/bin/env node
'use strict';
// afterShellExecution / PostToolUse (Bash): record which configured checks ran and whether they passed.
// Only an honest run counts: no `|| true`, not inside echo/grep, exit code when the runtime gives one.
const P = require('./lib/protocol');
const S = require('./lib/state');
const { checkMatcher, FAIL_MARKERS } = require('./lib/patterns');
const shell = require('./lib/shell');

const input = P.readStdin();
const cmd = P.shellCommand(input) || '';
if (!cmd) P.done();
const root = P.realRoot(P.projectRoot(input));
const cfg = S.loadConfig(root);
if (cfg.corrupt) P.done();
const session = P.sessionId(input);
const state = S.load(root, session);

let resp = input.tool_response || input.tool_output || input.toolResult || {};
if (typeof resp === 'string') { try { resp = JSON.parse(resp); } catch { resp = { output: resp }; } }
const output = [input.output, resp.stdout, resp.stderr, resp.output, resp.content].filter((x) => typeof x === 'string').join('\n');
const exitCode = [input.exit_code, input.exitCode, resp.exit_code, resp.exitCode, resp.code].find((x) => typeof x === 'number');
const failed = typeof exitCode === 'number' ? exitCode !== 0 : FAIL_MARKERS.test(output);

const parsed = shell.parse(cmd);
const swallowsFailure = parsed.pipelines.some((p) => p.op === '||');
const NOISE = /^(echo|printf|grep|rg|cat|true|false|test|\[|type|which|man|help)$/;
let changed = false;
if (!swallowsFailure) {
  for (const check of cfg.checks || []) {
    const re = checkMatcher(check.command);
    for (const p of parsed.pipelines) {
      const head = p.segments[0];
      if (!head || NOISE.test(head.first)) continue;
      if (!re.test(head.masked)) continue;
      // a pipeline like `npm run lint | tail` hides the exit code; trust markers only
      const ok = p.segments.length === 1 ? !failed : !FAIL_MARKERS.test(output);
      state.checks[check.id] = ok ? 'green' : 'red';
      changed = true;
    }
  }
}
if (changed) S.save(root, session, state);
P.done();

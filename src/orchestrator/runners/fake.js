'use strict';
// Fake runner for tests and dry runs: no API, no network. Answers come from a fixture directory
// (FENCELINE_FAKE_DIR) keyed by the phase name in opts.phase: <phase>.json (structured output) and
// optionally <phase>.files.json ({ "path": "content" }) which the fake "agent" writes into cwd,
// exactly like a real agent that was allowed Write(...) would.
const fs = require('fs');
const path = require('path');

const id = 'fake';
const label = 'Fake runner (tests)';

function detect() { return { installed: true, version: 'fake' }; }
function authHint() { return 'fake runner never needs auth'; }

async function run(opts) {
  const dir = process.env.FENCELINE_FAKE_DIR;
  const phase = opts.phase || 'unknown';
  let json = null;
  let text = `fake ${phase}`;
  if (dir) {
    const jp = path.join(dir, `${phase}.json`);
    if (fs.existsSync(jp)) { json = JSON.parse(fs.readFileSync(jp, 'utf8')); text = JSON.stringify(json); }
    const fp = path.join(dir, `${phase}.files.json`);
    if (fs.existsSync(fp)) {
      const files = JSON.parse(fs.readFileSync(fp, 'utf8'));
      for (const [rel, content] of Object.entries(files)) { const abs = path.join(opts.cwd, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, content); }
    }
  }
  if (opts.onEvent) opts.onEvent({ type: 'fake', phase });
  return { ok: true, text, json, events: [], sessionId: `fake-${phase}`, costUsd: 0, turns: 1, durationMs: 1, exitCode: 0, stderr: '', authFail: false, raw: null };
}

function toolsReadOnly() { return []; }
function toolsWrite() { return []; }

module.exports = { id, label, detect, run, authHint, toolsReadOnly, toolsWrite, experimental: false, hidden: true };

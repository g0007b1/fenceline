'use strict';
// Per-session hook state (edited files, check results, stop attempts) in .fenceline/state/<session>.json.
// Two agents in the same checkout do not see each other's state. Old files are garbage-collected.
// FENCELINE_STATE_FILE overrides the location (used by `fenceline doctor`).
const fs = require('fs');
const path = require('path');

function statePath(root, session) {
  if (process.env.FENCELINE_STATE_FILE) return process.env.FENCELINE_STATE_FILE;
  return path.join(root, '.fenceline', 'state', `${session || 'default'}.json`);
}
function fresh() {
  return { editedFiles: [], checks: {}, stopAttempts: 0, reviewed: false, docsSynced: false, integrationTriggers: [], updatedAt: null };
}
function load(root, session) {
  try { return { ...fresh(), ...JSON.parse(fs.readFileSync(statePath(root, session), 'utf8')) }; } catch { return fresh(); }
}
function save(root, session, state) {
  const p = statePath(root, session);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
}
function reset(root, session) { save(root, session, fresh()); }

function gc(root, maxAgeMs = 2 * 24 * 3600 * 1000) {
  const dir = path.join(root, '.fenceline', 'state');
  try {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      try { if (Date.now() - fs.statSync(p).mtimeMs > maxAgeMs) fs.unlinkSync(p); } catch { /* ignore */ }
    }
  } catch { /* no dir yet */ }
}

// Fail closed: a config that exists but cannot be parsed (or is missing while hooks are installed)
// must not silently turn every guard off.
function loadConfig(root) {
  const p = path.join(root, '.fenceline', 'config.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {
    const installed = fs.existsSync(path.join(root, '.fenceline', 'hooks'));
    return { corrupt: installed, corruptReason: fs.existsSync(p) ? `cannot parse ${p}: ${e.message}` : `missing ${p}` };
  }
}

// Baseline written by `fenceline task` before the agent starts: which checks already failed on the base branch and
// with which error lines. A check that fails only with those same lines is not the agent's problem.
function baseline(root) {
  try { const b = JSON.parse(fs.readFileSync(path.join(root, '.fenceline', 'state', 'baseline.json'), 'utf8')); return b && b.checks ? b : null; } catch { return null; }
}
function errorLines(out) {
  return [...new Set(String(out || '').split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter((l) => /\berror\b|\bfail(ed|ure)?\b|✖|✗|\bTS\d{4}\b/i.test(l) && !/^\d+ (error|problem)s?/i.test(l)))];
}
module.exports = { load, save, reset, fresh, gc, loadConfig, statePath, baseline, errorLines };

'use strict';
// Agent runtimes that can be *driven* by fenceline (as opposed to *configured* — see src/adapters/).
// A runner spawns the runtime's CLI in non-interactive mode and returns text / structured JSON.
const claude = require('./claude');
const fake = require('./fake');

const runners = { claude, fake };
// Cursor (`agent -p`), Codex (`codex exec`) and Gemini (`gemini -p`) are added here once their
// non-interactive flags are verified; the runner contract is the same.
function loadOptional(name) { try { const r = require(`./${name}`); runners[r.id] = r; } catch { /* not present yet */ } }
['cursor', 'codex', 'gemini'].forEach(loadOptional);

function listRunners() { return Object.values(runners).filter((r) => !r.hidden); }
function getRunner(id) {
  if (!runners[id]) throw new Error(`Unknown agent runtime "${id}". Known: ${Object.keys(runners).filter((k) => !runners[k].hidden).join(', ')}`);
  return runners[id];
}
function detectRunners() {
  return listRunners().map((r) => ({ id: r.id, label: r.label, experimental: !!r.experimental, ...r.detect() }));
}

module.exports = { runners, listRunners, getRunner, detectRunners };

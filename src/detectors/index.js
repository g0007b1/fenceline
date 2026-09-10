'use strict';
// Ecosystem detection. Each detector returns null when its manifest is absent.
// The first hit is the primary stack; a Makefile/justfile fills in missing checks for any stack.
const node = require('./node');
const python = require('./python');
const go = require('./go');
const rust = require('./rust');
const generic = require('./generic');

const DETECTORS = [node, python, go, rust];

const SOURCE_EXT = { node: /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/, python: /\.py$/, go: /\.go$/, rust: /\.rs$/ };

// Primary = the ecosystem with the most source files; ties → more dependencies; then manifest order.
// A Django project with a package.json for Tailwind stays Python.
function detectStack(root, files = []) {
  const found = DETECTORS.map((d) => d.detect(root)).filter(Boolean);
  for (const f of found) {
    f.sourceFiles = files.filter((x) => SOURCE_EXT[f.ecosystem] && SOURCE_EXT[f.ecosystem].test(x) && !/(^|\/)(node_modules|vendor|dist|build)\//.test(x)).length;
    f.evidence = f.sourceFiles * 10 + f.depNames.length + (f.frameworks && Object.values(f.frameworks).filter(Boolean).length) * 3;
  }
  found.sort((a, b) => b.evidence - a.evidence);
  const primary = found[0] || generic.detect(root);
  const runner = generic.taskRunnerChecks(root);
  for (const k of Object.keys(primary.checks)) if (!primary.checks[k] && runner[k]) primary.checks[k] = runner[k];
  primary.ecosystems = found.length ? found.map((f) => f.ecosystem) : ['generic'];
  // Secondary ecosystems contribute their dependency names to risk detection.
  for (const other of found.slice(1)) primary.depNames = [...new Set([...primary.depNames, ...other.depNames])];
  return primary;
}

module.exports = { detectStack, DETECTORS };

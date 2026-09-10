'use strict';
const fs = require('fs');
const path = require('path');

function exists(root, rel) { return fs.existsSync(path.join(root, rel)); }
function read(root, rel) { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return ''; } }
function readJson(root, rel) { try { return JSON.parse(read(root, rel)); } catch { return null; } }

// Standard shape every detector returns. Fields not applicable stay at their defaults.
function stack(overrides) {
  return {
    ecosystem: 'generic',
    name: '',
    language: '',
    packageManager: '',
    runPrefix: '',            // e.g. "uv run " — prepended to tool commands
    typescript: false,
    monorepo: false,
    depNames: [],             // lowercase dependency identifiers (npm names, PyPI names, Go module paths, crates)
    frameworks: {},           // { react: true, django: true, … }
    checks: { lint: null, typeCheck: null, test: null, build: null },   // full shell commands or null
    suggestions: [],          // human-readable "add X" hints when a check is missing
    summary: [],              // words for the one-line stack description
    ...overrides,
  };
}

module.exports = { exists, read, readJson, stack };

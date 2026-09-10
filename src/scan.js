'use strict';
// Repository scanner. Pure Node, no dependencies. Produces the JSON "profile" that
// presets, templates, triage and the skill consume.
const fs = require('fs');
const path = require('path');
const { detectStack } = require('./detectors');
const { detectRisks } = require('./risks');
const { detectFragileZones, IGNORE } = require('./fragile');
const { choosePreset } = require('./presets');

function walkFiles(root, maxFiles = 20000) {
  const out = [];
  (function walk(dir, rel) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      if (e.name.startsWith('.') && !e.name.startsWith('.env') && !['.github', '.gitlab-ci.yml', '.circleci', '.npmrc', '.pypirc', '.netrc'].includes(e.name)) continue;
      if (IGNORE.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r); else out.push(r);
    }
  })(root, '');
  return out;
}

const TEST_RE = /(\.|-|_)(test|spec)\.[jt]sx?$|__tests__\/|\/e2e\/|(^|\/)tests?\/.*\.py$|_test\.py$|(^|\/)test_[^/]+\.py$|_test\.go$|(^|\/)tests\/.*\.rs$/;
function detectTests(files) {
  const testFiles = files.filter((f) => TEST_RE.test(f));
  return { count: testFiles.length, sample: testFiles.slice(0, 5) };
}

function detectSiblings(root) {
  const parent = path.dirname(root);
  let entries = [];
  try { entries = fs.readdirSync(parent, { withFileTypes: true }); } catch { return []; }
  const manifests = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', '.git'];
  return entries
    .filter((e) => e.isDirectory() && e.name !== path.basename(root) && !e.name.startsWith('.'))
    .filter((e) => manifests.some((m) => fs.existsSync(path.join(parent, e.name, m))))
    .map((e) => `../${e.name}`)
    .slice(0, 10);
}

function detectAgentDocs(root) {
  return ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorrules', '.cursor/rules', '.cursor/hooks.json', '.claude/settings.json', '.claude/rules', '.windsurfrules', '.github/copilot-instructions.md', '.agents/skills']
    .filter((f) => fs.existsSync(path.join(root, f)));
}

function scan(root) {
  root = path.resolve(root);
  const files = walkFiles(root);
  const stack = detectStack(root, files);
  const risks = detectRisks(stack, files);
  const fragile = detectFragileZones(root);
  const tests = detectTests(files);
  const siblings = detectSiblings(root);
  const existingAgentDocs = detectAgentDocs(root);
  const preset = choosePreset(stack);
  const topDirs = [...new Set(files.map((f) => f.split('/')[0]))].filter((d) => !d.includes('.')).slice(0, 25);
  const ci = fs.existsSync(path.join(root, '.github/workflows')) ? 'github-actions' : fs.existsSync(path.join(root, '.gitlab-ci.yml')) ? 'gitlab-ci' : fs.existsSync(path.join(root, 'Jenkinsfile')) ? 'jenkins' : null;
  const envExample = fs.existsSync(path.join(root, '.env.example')) || fs.existsSync(path.join(root, '.env.sample'));
  const warnings = [
    !stack.checks.lint && !stack.suggestions.some((x) => /lint/i.test(x)) && 'No lint command found — the stop-hook cannot enforce lint until one exists.',
    tests.count === 0 && 'No tests detected — agents will have nothing to prove their changes with.',
    !envExample && files.some((f) => /^\.env/.test(f)) && 'No .env.example — agents cannot learn required env without reading secrets.',
    ...stack.suggestions,
  ].filter(Boolean);
  return {
    version: 2, scannedAt: new Date().toISOString(), root, preset,
    stack: { ...stack, ci, envExample, existingAgentDocs },
    files: { count: files.length, topDirs }, tests, risks, fragile, siblings, warnings,
  };
}

module.exports = { scan, walkFiles };

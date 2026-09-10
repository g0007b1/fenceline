'use strict';
const path = require('path');
const { exists, read, stack } = require('./util');

// Makefile / justfile targets are the lingua franca when no ecosystem is recognised.
function taskRunnerChecks(root) {
  const out = { lint: null, typeCheck: null, test: null, build: null };
  const sources = [['Makefile', 'make'], ['makefile', 'make'], ['justfile', 'just'], ['Justfile', 'just'], ['Taskfile.yml', 'task'], ['Taskfile.yaml', 'task']];
  for (const [file, runner] of sources) {
    if (!exists(root, file)) continue;
    const text = read(root, file);
    const targets = new Set([...text.matchAll(/^([A-Za-z0-9_-]+):/gm)].map((m) => m[1]));
    const pick = (...names) => names.find((n) => targets.has(n));
    const l = pick('lint', 'check', 'fmt-check'); const t = pick('typecheck', 'type-check', 'types', 'mypy'); const te = pick('test', 'tests', 'unit'); const b = pick('build');
    if (l) out.lint = out.lint || `${runner} ${l}`; if (t) out.typeCheck = out.typeCheck || `${runner} ${t}`; if (te) out.test = out.test || `${runner} ${te}`; if (b) out.build = out.build || `${runner} ${b}`;
  }
  return out;
}

function detect(root) {
  const checks = taskRunnerChecks(root);
  const hasRunner = Object.values(checks).some(Boolean);
  const summary = [];
  if (exists(root, 'pom.xml') || exists(root, 'build.gradle') || exists(root, 'build.gradle.kts')) summary.push('JVM');
  if (exists(root, 'Gemfile')) summary.push('Ruby');
  if (exists(root, 'composer.json')) summary.push('PHP');
  if (exists(root, 'mix.exs')) summary.push('Elixir');
  if (exists(root, 'pubspec.yaml')) summary.push('Dart/Flutter');
  if (exists(root, 'Package.swift') || [...(safeList(root))].some((f) => f.endsWith('.xcodeproj'))) summary.push('Swift');
  if (exists(root, 'CMakeLists.txt')) summary.push('C/C++ (CMake)');
  if (hasRunner) summary.push('task runner');
  return stack({ ecosystem: 'generic', name: path.basename(root), language: summary[0] ? summary[0].toLowerCase() : 'unknown',
    packageManager: hasRunner ? 'make' : '', checks,
    suggestions: hasRunner ? [] : ['No lint/test commands detected. Add a Makefile with `lint` and `test` targets (or a package manifest) so the stop-hook has something to enforce.'],
    summary: summary.length ? summary : ['unrecognised stack'] });
}

function safeList(root) { try { return require('fs').readdirSync(root); } catch { return []; } }

module.exports = { id: 'generic', detect, taskRunnerChecks };

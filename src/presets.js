'use strict';
// Preset loader. A preset is a directory under presets/<id>/ with preset.js (data) and rules/*.mdc.
// Every preset extends _base; optional layers (monorepo) and modules (migrations) stack on top.
// Arrays are concatenated and de-duplicated by regex source; scalars are overridden.
const fs = require('fs');
const path = require('path');

const PRESETS_DIR = path.join(__dirname, '..', 'presets');

function listPresets() {
  return fs.readdirSync(PRESETS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && fs.existsSync(path.join(PRESETS_DIR, e.name, 'preset.js')))
    .map((e) => e.name).sort();
}
function loadRaw(id) { return require(path.join(PRESETS_DIR, id, 'preset.js')); }

// Path patterns may be RegExp or { re, label }.
function normPath(x) { return x instanceof RegExp ? { re: x, label: null } : { re: x.re, label: x.label || null }; }
function dedupe(list, key) { const seen = new Set(); return list.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); }

// Rule references: "file.mdc" → own rules dir; "<preset>/file.mdc" → another preset's rules dir.
function resolveRule(ownerId, ref) {
  const [dir, file] = ref.includes('/') ? ref.split('/') : [ownerId, ref];
  return { name: file, path: path.join(PRESETS_DIR, dir, 'rules', file) };
}

function merge(layers) {
  const cat = (k) => layers.flatMap((l) => l[k] || []);
  const tri = (k) => layers.flatMap((l) => (l.triage && l.triage[k]) || []);
  const doc = (k) => layers.flatMap((l) => (l.doctor && l.doctor[k]) || []);
  const last = (k) => layers.map((l) => l[k]).filter((v) => v != null).pop();
  return {
    denyWrite: dedupe(cat('denyWrite').map(normPath), (x) => x.re.source),
    denyRead: dedupe(cat('denyRead').map(normPath), (x) => x.re.source),
    denyShell: dedupe(cat('denyShell'), (x) => x.re.source),
    denyWriteHint: last('denyWriteHint'),
    integrationTriggers: dedupe(cat('integrationTriggers'), (x) => x.source),
    codeFilePattern: last('codeFilePattern') || null,
    rules: dedupe(layers.flatMap((l) => (l.rules || []).map((r) => resolveRule(l.id, r))), (r) => r.path),
    hardBans: [...new Set(cat('hardBans'))],
    safeAuto: [...new Set(cat('safeAuto'))],
    safeHuman: [...new Set(cat('safeHuman'))],
    triage: { human: [...new Set(tri('human'))], auto: [...new Set(tri('auto'))], ac: [...new Set(tri('ac'))] },
    doctor: { denyPaths: [...new Set(doc('denyPaths'))], allowPaths: [...new Set(doc('allowPaths'))], denyShell: [...new Set(doc('denyShell'))], askShell: [...new Set(doc('askShell'))], allowShell: [...new Set(doc('allowShell'))] },
  };
}

// getPreset('react-web', { layers: ['monorepo'], modules: ['migrations'] })
function getPreset(id, { layers = [], modules = [] } = {}) {
  const ids = listPresets();
  if (!ids.includes(id)) throw new Error(`Unknown preset "${id}". Known: ${ids.join(', ')}`);
  const base = loadRaw('_base');
  const own = loadRaw(id);
  const stack = [base, own, ...layers.filter((l) => l !== id && ids.includes(l)).map(loadRaw), ...modules.map((m) => ({ id: '_base', ...(base.modules && base.modules[m]) })).filter((m) => m.denyWrite || m.denyShell)];
  return { id, label: own.label || id, description: own.description || '', layers: layers.filter((l) => l !== id), modules, ...merge(stack) };
}

function choosePreset(stack) {
  const f = stack.frameworks || {};
  switch (stack.ecosystem) {
    case 'node':
      if (f.expo || f.reactNative) return 'expo';
      if (f.react || f.next || f.remix || f.vue || f.nuxt || f.svelte || f.angular || f.vite) return 'react-web';
      if (f.server) return 'node-api';
      return stack.monorepo ? 'monorepo' : 'node';
    case 'python': return 'python';
    case 'go': return 'go';
    case 'rust': return 'rust';
    default: return 'generic';
  }
}

// Layers and modules the scanner decides on, independent of the preset.
function chooseLayers(profile) {
  const layers = profile.stack.monorepo ? ['monorepo'] : [];
  const modules = profile.risks.some((r) => r.id === 'migrations' && r.deps.length) ? ['migrations'] : [];
  return { layers, modules };
}

module.exports = { listPresets, getPreset, choosePreset, chooseLayers, PRESETS_DIR };

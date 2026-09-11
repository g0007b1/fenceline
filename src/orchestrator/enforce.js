'use strict';
// Enforcement is deterministic: the agent decides WHAT (protected paths, checks, branches, siblings),
// this module decides HOW (config + hooks + runtime hook configs). Nothing here needs an API.
const fs = require('fs');
const path = require('path');
const { getPreset, chooseLayers } = require('../presets');
const { scan } = require('../scan');
const { getAdapters } = require('../adapters');
const { getProfile } = require('../profiles');
const { HOOK_SCRIPTS, GITIGNORE, GI_BEGIN, GI_END } = require('../init');
const { globToRegex } = require('./pipeline-utils');

function ensureGitignore(root, entries) {
  const file = path.join(root, '.gitignore');
  let existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (existing.includes(GI_BEGIN) && existing.includes(GI_END)) existing = existing.slice(0, existing.indexOf(GI_BEGIN)) + existing.slice(existing.indexOf(GI_END) + GI_END.length).replace(/^\n/, '');
  const lines = existing.split('\n').map((l) => l.trim());
  const missing = entries.filter((e) => !lines.includes(e));
  fs.writeFileSync(file, existing + (existing.endsWith('\n') || !existing ? '' : '\n') + (missing.length ? `${GI_BEGIN}\n${missing.join('\n')}\n${GI_END}\n` : ''));
}

function apply(root, diagnosis, opts) {
  const profile = scan(root);
  const { layers, modules } = chooseLayers(profile);
  const preset = getPreset(profile.preset, { layers, modules });
  const prof = getProfile(opts.profile || 'balanced').config;
  const adapters = getAdapters(opts.targets);
  const enforcing = adapters.filter((a) => a.enforces);
  const rulesPath = (enforcing[0] || adapters[0]).rulesPath;

  // paths: base secrets/tooling patterns + what the diagnosis named
  const denyWrite = preset.denyWrite.map((p) => ({ source: p.re.source, flags: p.re.flags, label: p.label || null }));
  const MUST_ALLOW = ['.env.example', '.env.sample', 'README.md', 'package.json', 'src/index.ts', 'docs/README.md'];
  const skipped = [];
  for (const p of diagnosis.protectedPaths || []) {
    const g = (p.glob || '').trim();
    if (!g || /^(\*|\*\*|\.|\/|src\/?|src\/\*\*)$/.test(g)) { skipped.push(g + ' (whole tree)'); continue; }
    // base patterns already cover secrets with the right exceptions; build artefacts are not "protected", just noise
    if (/^\.?\/?(\.env|\.envrc|node_modules|dist|build|out|\.next|coverage|\.fenceline|\.git|\.cache|target|__pycache__|\.venv|venv)(\/|\*|$)/.test(g)) { skipped.push(g + ' (covered by base / build artefact)'); continue; }
    const source = globToRegex(g);
    const re = new RegExp(source);
    if (MUST_ALLOW.some((f) => re.test(f))) { skipped.push(g + ' (would deny ' + MUST_ALLOW.find((f) => re.test(f)) + ')'); continue; }
    denyWrite.push({ source, flags: '', label: p.label || g, reason: p.reason || null, from: 'diagnosis' });
  }
  const checks = (diagnosis.checks || []).filter((c) => c.command && c.verified !== false).map((c, i) => ({ id: c.id || `check${i + 1}`, command: c.command }));
  if (!checks.length) { if (profile.stack.checks.lint) checks.push({ id: 'lint', command: profile.stack.checks.lint }); if (profile.stack.checks.typeCheck) checks.push({ id: 'typeCheck', command: profile.stack.checks.typeCheck }); }
  const baseBranch = detectBaseBranch(root);
  const protectedBranches = [...new Set([baseBranch, ...(opts.protectedBranches || diagnosis.protectedBranches || []), 'main', 'master'])];
  const siblings = opts.siblings != null ? opts.siblings : (diagnosis.siblingRepos || []).filter((s) => fs.existsSync(path.resolve(root, s)));

  const cfg = {
    version: 3, generatedAt: new Date().toISOString(), generatedBy: 'fenceline orchestrator',
    preset: preset.id, presetLabel: preset.label, layers, modules, ecosystem: profile.stack.ecosystem, packageManager: profile.stack.packageManager,
    runtimes: opts.targets, components: opts.hasHooks ? ['hooks', 'rules', 'docs', 'domain-docs', 'templates'] : ['rules', 'docs', 'domain-docs', 'templates'],
    profile: opts.profile || 'balanced', checks, checksOverridden: true, runChecksOnStop: prof.runChecksOnStop, checkTimeoutMs: 180000,
    gates: prof.gates, strictness: prof.strictness,
    denyWrite, denyRead: preset.denyRead.map((p) => ({ source: p.re.source, flags: p.re.flags, label: p.label || null })),
    denyWriteHint: 'this path is human-only in this repository (see AGENTS.md "Hard bans"); describe the change in your answer instead',
    denyShell: preset.denyShell.map((r) => ({ source: r.re.source, flags: r.re.flags, why: r.why, severity: r.severity || 'deny' })),
    integrationTriggers: preset.integrationTriggers.map((re) => ({ source: re.source, flags: re.flags })),
    codeFilePattern: null, siblings, allowOutsideRoot: [], protectedBranches, failClosed: true, maxStopAttempts: prof.maxStopAttempts,
    rulesPath, baseBranch, branchPrefix: 'agent/', draftPr: true,
    diagnosis: { entities: (diagnosis.entities || []).length, fragileZones: (diagnosis.fragileZones || []).map((z) => z.dir), riskAreas: (diagnosis.riskAreas || []).map((r) => r.id) },
  };
  fs.mkdirSync(path.join(root, '.fenceline'), { recursive: true });
  fs.writeFileSync(path.join(root, '.fenceline', 'config.json'), JSON.stringify(cfg, null, 2) + '\n');
  fs.writeFileSync(path.join(root, '.fenceline', 'profile.json'), JSON.stringify(profile, null, 2) + '\n');
  ensureGitignore(root, GITIGNORE);
  const wired = [];
  if (opts.hasHooks) {
    const hooksDir = path.join(root, '.fenceline', 'hooks');
    fs.mkdirSync(path.join(hooksDir, 'lib'), { recursive: true });
    for (const f of HOOK_SCRIPTS) fs.copyFileSync(path.join(__dirname, '..', '..', 'hooks', f), path.join(hooksDir, f));
    for (const f of fs.readdirSync(path.join(__dirname, '..', '..', 'hooks', 'lib'))) fs.copyFileSync(path.join(__dirname, '..', '..', 'hooks', 'lib', f), path.join(hooksDir, 'lib', f));
    for (const a of adapters) { const r = a.writeHooksConfig(root, cfg); if (r) wired.push(r.file); }
  }
  // templates the agent does not write
  const R = require('../render');
  R.writeIfMissing(path.join(root, 'docs', 'handoffs', '_TEMPLATE.md'), R.loadTemplate(path.join('handoffs', '_TEMPLATE.md')));
  R.writeIfMissing(path.join(root, 'docs', 'adr', '_TEMPLATE.md'), R.loadTemplate(path.join('adr', '_TEMPLATE.md')));
  return { cfg, summary: { protectedPaths: denyWrite.length, fromDiagnosis: denyWrite.filter((d) => d.from === 'diagnosis').length, skippedGlobs: skipped, checks: checks.length, wired, siblings, protectedBranches } };
}

function detectBaseBranch(root) {
  const { execSync } = require('child_process');
  try { return execSync('git symbolic-ref refs/remotes/origin/HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim().split('/').pop() || 'main'; }
  catch { try { const b = execSync('git branch --list', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }); return /\bmain\b/.test(b) ? 'main' : /\bmaster\b/.test(b) ? 'master' : 'main'; } catch { return 'main'; } }
}

// Rules written by the compose agent to docs/agent-rules/*.md (mdc-style frontmatter) → each runtime's native format.
function distributeRules(root, targets) {
  const src = path.join(root, 'docs', 'agent-rules');
  if (!fs.existsSync(src)) return [];
  const out = [];
  const files = fs.readdirSync(src).filter((f) => f.endsWith('.md'));
  for (const a of getAdapters(targets)) {
    if (a.rulesPath === 'docs/agent-rules') continue; // already native
    for (const f of files) {
      const raw = fs.readFileSync(path.join(src, f), 'utf8').replace(/\r\n/g, '\n');
      const body = a.convertRule ? a.convertRule(raw) : raw;
      const target = path.join(root, a.rulesPath, f.replace(/\.md$/, a.ruleExt));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
      out.push(path.relative(root, target));
    }
  }
  return out;
}

module.exports = { apply, distributeRules };

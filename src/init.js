'use strict';
// init / refresh: scan → preset (+ layers / modules) → config → files (hooks, rules, commands, docs).
// Everything generated is marker-managed (docs), namespaced (.fenceline/, fenceline-*) or merged
// (hooks config), so re-running is safe and uninstall is a clean inverse.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { scan } = require('./scan');
const { getPreset, chooseLayers } = require('./presets');
const { getAdapters } = require('./adapters');
const R = require('./render');
const { getProfile, COMPONENTS } = require('./profiles');

const HOOK_SCRIPTS = ['guard-write.js', 'guard-read.js', 'guard-shell.js', 'track-edit.js', 'track-checks.js', 'ensure-checks.js', 'session-start.js'];
const COMMANDS = ['fenceline-review', 'fenceline-pr', 'fenceline-handoff', 'fenceline-domain-doc', 'fenceline-triage'];
const GITIGNORE = ['.fenceline/state/', '.fenceline/state.json', '.fenceline/profile.json', '.fenceline/audit.log', '.env', '.env.*', '!.env.example', '!.env.sample'];

const serialize = (re) => ({ source: re.source, flags: re.flags });
const serializePath = (x) => ({ source: x.re.source, flags: x.re.flags, label: x.label || null });
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildConfig(profile, preset, opts) {
  const s = profile.stack;
  const denyWrite = [...preset.denyWrite];
  for (const r of profile.risks) {
    if (r.id === 'secrets') for (const p of r.paths) if (!/\.env\.(example|sample|template)$/.test(p) && !denyWrite.some((d) => d.re.test(p))) denyWrite.push({ re: new RegExp('^' + escapeRe(p) + '$'), label: p });
  }
  const prof = getProfile(opts.profile || 'balanced').config;
  let checks = [];
  if (opts.checks && opts.checks.length) checks = opts.checks.map((c, i) => ({ id: c.id || `check${i + 1}`, command: c.command || c }));
  else {
    if (s.checks.lint) checks.push({ id: 'lint', command: s.checks.lint });
    if (s.checks.typeCheck) checks.push({ id: 'typeCheck', command: s.checks.typeCheck });
    if ((opts.requireTests || prof.requireTests) && s.checks.test) checks.push({ id: 'test', command: s.checks.test });
  }
  return {
    version: 3,
    generatedAt: new Date().toISOString(),
    preset: preset.id,
    presetLabel: preset.label,
    layers: preset.layers,
    modules: preset.modules,
    ecosystem: s.ecosystem,
    packageManager: s.packageManager,
    runtimes: opts.runtimes,
    components: opts.components,
    profile: opts.profile || 'balanced',
    checks,
    runChecksOnStop: prof.runChecksOnStop,   // missing | always | never
    checkTimeoutMs: 180000,
    gates: { ...prof.gates, ...(opts.gates || {}) },            // review | docsSync
    strictness: { ...prof.strictness, ...(opts.strictness || {}) },
    denyWrite: denyWrite.map(serializePath),
    denyRead: preset.denyRead.map(serializePath),
    denyWriteHint: preset.denyWriteHint || 'this path is human-only; describe the needed change in your final answer instead of editing it',
    denyShell: preset.denyShell.map((r) => ({ ...serialize(r.re), why: r.why, severity: r.severity || 'deny' })),
    integrationTriggers: preset.integrationTriggers.map(serialize),
    codeFilePattern: preset.codeFilePattern ? serialize(preset.codeFilePattern) : null,
    siblings: opts.siblings,
    allowOutsideRoot: [],
    protectedBranches: opts.protectedBranches && opts.protectedBranches.length ? [...new Set([opts.baseBranch, ...opts.protectedBranches])] : [...new Set([opts.baseBranch, 'main', 'master', 'develop', 'production', 'staging', 'trunk'])],
    failClosed: true,
    maxStopAttempts: prof.maxStopAttempts,
    rulesPath: opts.rulesPath,
    baseBranch: opts.baseBranch,
    branchPrefix: opts.branchPrefix,
    draftPr: true,
  };
}

function checkCommands(cfg) {
  const cmds = cfg.checks.map((c) => c.command);
  return cmds.length ? cmds.join('\n') : '# TODO(fenceline): no lint / type-check commands detected — add them (see `fenceline scan` warnings); hooks cannot enforce what does not exist';
}

function hardBans(cfg, profile, preset) {
  const lines = [];
  const labels = [...new Set(cfg.denyWrite.map((p) => p.label).filter(Boolean))];
  lines.push(`- Protected paths — writes are denied by hooks, from edit tools **and** from the shell: ${labels.join('; ')}.`);
  lines.push('- Secrets (`.env`, keys, credentials) are never read into the agent context; `.env.example` is the interface.');
  lines.push('- The hook machinery (`.fenceline/`, the runtime hook config) is protected; an unreadable config denies everything (fail-closed).');
  if (cfg.siblings.length) lines.push(`- Sibling repositories are **read-only**: ${cfg.siblings.map((s) => '`' + s + '`').join(', ')} — from edit tools and from the shell (\`cd\` chains included). Record mismatches in \`docs/handoffs/\`.`);
  lines.push(`- Protected branches (${cfg.protectedBranches.map((b) => '`' + b + '`').join(', ')}): no direct push, no force-push, no \`git reset --hard\`, no \`git clean -f\` — parsed, not pattern-matched, so \`feature/main-page\` is fine.`);
  for (const b of preset.hardBans) lines.push(`- ${b}`);
  for (const r of profile.risks.filter((x) => ['payments', 'auth', 'push', 'jobs', 'email'].includes(x.id))) {
    lines.push(`- ${r.label}: human-only (convention, reviewed by people). Detected via ${[...r.deps, ...r.paths.slice(0, 3)].map((x) => '`' + x + '`').join(', ')}.`);
  }
  return lines.join('\n');
}

function riskZones(profile) {
  if (!profile.risks.length) return '_No specific risk zones detected by the scanner. Add your own below the managed block._';
  return profile.risks.map((r) => {
    const ev = [...r.deps.map((d) => `dep \`${d}\``), ...r.paths.slice(0, 4).map((p) => '`' + p + '`')].join(', ');
    return `- **${r.label}** — human-only. Evidence: ${ev}.`;
  }).join('\n');
}

function slug(dir) { return dir.replace(/^(src|app|lib|pkg|internal|packages|apps)\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(); }

function fragileList(profile) {
  if (!profile.fragile.available) return '_Git history not available — fragile zones could not be detected. Add them by hand._';
  if (!profile.fragile.zones.length) return '_No high-churn areas detected in the last 18 months. Add zones by hand when you know them._';
  return profile.fragile.zones.map((z) => `- \`${z.dir}\` → \`docs/${slug(z.dir)}.md\` (${z.commits} commits, ${z.fixes} bug-fix commits, ${z.authors} authors)`).join('\n');
}

function breaksPr(profile, preset) {
  const items = [
    'Red lint or type-check (the stop-hook runs them and blocks the agent until green)',
    'Touching a protected path (secrets, generated code, migrations, sibling repos — see AGENTS.md)',
    'Scope creep: files changed that the task did not ask for',
    'Missing "How to test" section / test plan',
    'Convention violations listed in ' + preset.rules.map((r) => '`' + r.name.replace(/\.mdc$/, '') + '`').join(', '),
  ];
  if (profile.tests.count === 0) items.push('_No tests exist yet — the first PR that adds a test harness is human-led._');
  return items.map((i) => `- ${i}`).join('\n');
}

function dataLayer(stack) {
  const f = stack.frameworks || {};
  if (f.redux) return 'RTK Query'; if (f.tanstackQuery) return 'TanStack Query'; if (f.next) return 'server components / route handlers';
  return 'the API layer';
}

// Previous answers (from an earlier init) are the defaults for refresh.
function previousConfig(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.fenceline', 'config.json'), 'utf8')); } catch { return null; }
}

function run(root, opts) {
  root = path.resolve(root);
  const prev = previousConfig(root);
  const profile = scan(root);
  const presetId = opts.preset || (prev && prev.preset) || profile.preset;
  const { layers, modules } = chooseLayers(profile);
  const preset = getPreset(presetId, { layers, modules });
  const runtimes = opts.runtimes && opts.runtimes.length ? opts.runtimes : (prev && prev.runtimes && prev.runtimes.length ? prev.runtimes : detectRuntimes(root));
  const adapters = getAdapters(runtimes);
  const enforcing = adapters.filter((a) => a.enforces);
  const rulesPath = (enforcing[0] || adapters[0]).rulesPath;
  const components = new Set(opts.components && opts.components.length ? opts.components : (prev && prev.components) || COMPONENTS.filter((c) => c.default).map((c) => c.id));
  const has = (c) => components.has(c);
  // Siblings are opt-in: neighbouring repos are only *suggested* by scan.
  const siblings = opts.siblings != null ? opts.siblings : (prev && prev.siblings) || [];
  const dry = !!opts.dryRun;
  const cfg = buildConfig(profile, preset, {
    runtimes, siblings, rulesPath, components: [...components],
    profile: opts.profile || (prev && prev.profile) || 'balanced',
    gates: opts.gates || (prev && !opts.profile ? prev.gates : null),
    strictness: opts.strictness || (prev && !opts.profile ? prev.strictness : null),
    checks: opts.checks || (prev && prev.checksOverridden ? prev.checks : null),
    protectedBranches: opts.protectedBranches || (prev && prev.protectedBranches) || null,
    baseBranch: opts.baseBranch || (prev && prev.baseBranch) || detectBaseBranch(root),
    branchPrefix: opts.branchPrefix || (prev && prev.branchPrefix) || 'agent/',
    requireTests: !!opts.requireTests,
  });
  cfg.checksOverridden = !!(opts.checks || (prev && prev.checksOverridden));

  const report = [];
  const rec = (file, status) => report.push({ file, status: dry ? `would ${status.replace(/d$/, '')}`.replace('would installe', 'would install').replace('would writte', 'would write') : status });
  const writeFile = (target, content) => { if (!dry) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); } };

  // 1. config (always) + hooks (component)
  if (!dry) fs.mkdirSync(path.join(root, '.fenceline'), { recursive: true });
  if (has('hooks')) {
    const hooksDir = path.join(root, '.fenceline', 'hooks');
    if (!dry) {
      fs.mkdirSync(path.join(hooksDir, 'lib'), { recursive: true });
      for (const f of HOOK_SCRIPTS) fs.copyFileSync(path.join(__dirname, '..', 'hooks', f), path.join(hooksDir, f));
      for (const f of fs.readdirSync(path.join(__dirname, '..', 'hooks', 'lib'))) fs.copyFileSync(path.join(__dirname, '..', 'hooks', 'lib', f), path.join(hooksDir, 'lib', f));
    }
    rec('.fenceline/hooks/*', 'installed');
  }
  writeFile(path.join(root, '.fenceline', 'config.json'), JSON.stringify(cfg, null, 2) + '\n');
  rec('.fenceline/config.json', 'written');
  writeFile(path.join(root, '.fenceline', 'profile.json'), JSON.stringify(profile, null, 2) + '\n');
  rec('.fenceline/profile.json', 'written');
  if (!dry) ensureGitignore(root, GITIGNORE);
  if (has('hooks')) {
    for (const a of adapters) {
      if (dry) { rec(a.hooksFile || `(${a.label} hook config)`, a.isWired(root) ? 'updated' : 'created'); continue; }
      const r = a.writeHooksConfig(root, cfg);
      if (r) rec(r.file, r.status); else rec(`(${a.label})`, 'docs only — no hook API');
    }
  }

  // 2. template variables
  const vars = {
    name: profile.stack.name, rulesPath,
    stackLine: profile.stack.summary.join(', ') || 'TODO(fenceline): describe the stack',
    checkCommands: checkCommands(cfg),
    hardBans: hardBans(cfg, profile, preset), branchPrefix: cfg.branchPrefix, baseBranch: cfg.baseBranch,
    safeAuto: preset.safeAuto.map((s) => `- ${s}`).join('\n'), safeHuman: preset.safeHuman.map((s) => `- ${s}`).join('\n'),
    riskZones: riskZones(profile), fragileList: fragileList(profile), breaksPr: breaksPr(profile, preset),
    dataLayer: dataLayer(profile.stack),
    domainDocList: profile.fragile.zones.length ? profile.fragile.zones.map((z) => `- \`${slug(z.dir)}.md\` — \`${z.dir}\``).join('\n') : '_none yet — create one when a zone proves fragile_',
    runtimesLine: adapters.map((a) => a.label).join(' / '),
    enforcementNote: has('hooks') && enforcing.length
      ? `Gates in this file are **enforced by hooks** for ${enforcing.map((a) => a.label).join(', ')} (profile: ${cfg.profile}): protected paths and destructive commands are denied, and the stop-hook runs the checks itself and refuses to finish until they are green.${enforcing.some((a) => a.experimental) ? ' Runtimes marked experimental in README were wired from their published hook docs and are not yet verified against a live session.' : ''}\n`
      : '> **Note:** hooks are not installed in this repository. Everything below is convention, not enforcement — review accordingly. (`npx fenceline refresh --only hooks` adds them.)\n',
  };

  // 3. rules + commands, per runtime
  for (const a of adapters) {
    if (has('rules')) {
      for (const rule of preset.rules) {
        const raw = R.render(fs.readFileSync(rule.path, 'utf8').replace(/\r\n/g, '\n'), vars);
        const body = a.convertRule ? a.convertRule(raw) : raw;
        const target = path.join(root, a.rulesPath, 'fenceline-' + rule.name.replace(/\.mdc$/, a.ruleExt));
        const existed = fs.existsSync(target);
        writeFile(target, body);
        rec(path.relative(root, target), existed ? 'updated' : 'created');
      }
    }
    if (has('commands') && a.commandsPath) {
      for (const c of COMMANDS) {
        const target = path.join(root, a.commandsPath, c + '.md');
        const existed = fs.existsSync(target);
        writeFile(target, R.render(R.loadTemplate(path.join('commands', c + '.md')), vars));
        rec(path.relative(root, target), existed ? 'updated' : 'created');
      }
    }
  }

  // 4. docs (managed blocks — human text around them survives refresh)
  if (has('docs')) {
    rec('AGENTS.md', R.writeManaged(path.join(root, 'AGENTS.md'), R.render(R.loadTemplate('AGENTS.md.tmpl'), vars), { force: opts.force, dry }));
    rec('CLAUDE.md', R.writeManaged(path.join(root, 'CLAUDE.md'), R.render(R.loadTemplate('CLAUDE.md.tmpl'), vars), { force: opts.force, dry }));
    rec('docs/agent-safe-tasks.md', R.writeManaged(path.join(root, 'docs', 'agent-safe-tasks.md'), R.render(R.loadTemplate('agent-safe-tasks.md.tmpl'), vars), { force: opts.force, dry }));
    rec('docs/README.md', R.writeManaged(path.join(root, 'docs', 'README.md'), R.render(R.loadTemplate('docs-README.md.tmpl'), vars), { force: opts.force, dry }));
  }
  if (has('templates')) {
    rec('docs/handoffs/_TEMPLATE.md', R.writeIfMissing(path.join(root, 'docs', 'handoffs', '_TEMPLATE.md'), R.loadTemplate(path.join('handoffs', '_TEMPLATE.md')), { dry }));
    rec('docs/adr/_TEMPLATE.md', R.writeIfMissing(path.join(root, 'docs', 'adr', '_TEMPLATE.md'), R.loadTemplate(path.join('adr', '_TEMPLATE.md')), { dry }));
  }
  if (has('domain-docs')) {
    for (const z of profile.fragile.zones) {
      const target = path.join(root, 'docs', slug(z.dir) + '.md');
      rec(path.relative(root, target), R.writeIfMissing(target, R.render(R.loadTemplate('domain-doc.md.tmpl'), {
        zoneTitle: slug(z.dir).replace(/-/g, ' '), zoneDir: z.dir, commits: z.commits, fixes: z.fixes, authors: z.authors,
      }), { dry }));
    }
  }
  if (has('skill')) {
    const { installSkill, defaultTarget } = require('./skill');
    const where = dry ? path.relative(root, defaultTarget(root)) : installSkill(root, opts.skillTo);
    rec(where + '/', 'installed');
  }

  return { profile, cfg, preset, adapters, report, components: [...components], dry };
}

function detectRuntimes(root) {
  const r = [];
  if (fs.existsSync(path.join(root, '.cursor'))) r.push('cursor');
  if (fs.existsSync(path.join(root, '.claude')) || fs.existsSync(path.join(root, 'CLAUDE.md'))) r.push('claude');
  if (fs.existsSync(path.join(root, '.codex'))) r.push('codex');
  if (fs.existsSync(path.join(root, '.gemini')) || fs.existsSync(path.join(root, 'GEMINI.md'))) r.push('gemini');
  if (fs.existsSync(path.join(root, '.github', 'copilot-instructions.md'))) r.push('copilot');
  return r.length ? r : ['cursor', 'claude'];
}

function detectedRuntimes(root) { const r = detectRuntimes(root); return r.length === 2 && r[0] === 'cursor' && !fs.existsSync(path.join(root, '.cursor')) ? [] : r; }

function detectBaseBranch(root) {
  try {
    const ref = execSync('git symbolic-ref refs/remotes/origin/HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
    return ref.split('/').pop() || 'main';
  } catch {
    try {
      const branches = execSync('git branch --list', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
      if (/\bmain\b/.test(branches)) return 'main';
      if (/\bmaster\b/.test(branches)) return 'master';
    } catch { /* not a git repo */ }
    return 'main';
  }
}

// Our entries live in a delimited block so uninstall can remove exactly what we added.
const GI_BEGIN = '# fenceline:begin', GI_END = '# fenceline:end';
function ensureGitignore(root, entries) {
  const file = path.join(root, '.gitignore');
  let existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (existing.includes(GI_BEGIN) && existing.includes(GI_END)) existing = existing.slice(0, existing.indexOf(GI_BEGIN)) + existing.slice(existing.indexOf(GI_END) + GI_END.length).replace(/^\n/, '');
  const lines = existing.split('\n').map((l) => l.trim());
  const missing = entries.filter((e) => !lines.includes(e) && !(e === '.env' && lines.includes('.env*')) && !(e === '.env.*' && lines.includes('.env*')));
  if (!missing.length) { fs.writeFileSync(file, existing); return; }
  fs.writeFileSync(file, existing + (existing.endsWith('\n') || !existing ? '' : '\n') + `${GI_BEGIN}\n${missing.join('\n')}\n${GI_END}\n`);
}

module.exports = { run, slug, detectRuntimes, detectedRuntimes, detectBaseBranch, previousConfig, HOOK_SCRIPTS, COMMANDS, GITIGNORE, GI_BEGIN, GI_END };

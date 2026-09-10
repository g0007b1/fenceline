#!/usr/bin/env node
'use strict';
const path = require('path');
const fs = require('fs');

const HELP = `agent-ready — make any repository safe and productive for AI coding agents

Usage:
  agent-ready scan      [dir] [--json]        Detect stack, checks, risk zones, fragile areas. No writes.
  agent-ready init      [dir] [options]       Interactive setup (wizard in a terminal; defaults with --yes / in CI).
  agent-ready refresh   [dir] [options]       Re-run with the answers you gave last time; flags override.
  agent-ready check     [dir] [--no-run]      Verify the setup: hooks wired, checks runnable, docs present.
  agent-ready doctor    [dir] [--verbose]     Dry-run every guard (incl. bypass regressions) and simulate a session.
  agent-ready triage    [dir] "<task>" [--json]  Is this task safe for an automatic PR? auto / needs-ac / human.
  agent-ready config    get [key] | set <key> <value>   Read / change .agent-ready/config.json (dotted keys ok).
  agent-ready runtimes                        Which agent runtimes are detected here, and what each gets.
  agent-ready presets                         List stack presets.
  agent-ready skill     [dir] [--to <path>]   Copy the agent-ready skill into the repo's skills directory.
  agent-ready uninstall [dir] [--docs]        Remove everything agent-ready installed (--docs: also strip managed blocks).

Options for init / refresh:
  -y, --yes                     No questions: detected runtimes, balanced profile, default components
  -i, --interactive             Force the wizard (also for refresh)
  --dry-run                     Show what would be written; write nothing
  --runtime <id>                cursor | claude | codex | gemini | copilot  (repeatable)
  --preset <id>                 Override the detected stack preset (see: agent-ready presets)
  --profile <strict|balanced|light>   Strictness bundle (see below)
  --only <a,b>  /  --skip <a,b> Components: hooks, rules, commands, docs, domain-docs, templates, skill
  --no-review                   Stop hook does not ask for a self-review
  --no-docs-sync                Stop hook does not ask to sync docs after dependency / env / CI edits
  --check "<command>"           Use this command as a gate instead of the detected ones (repeatable)
  --require-tests               Also require the detected test command on stop
  --protected-branches <a,b>    Branches an agent may never push to directly (default: base + main/master/develop/…)
  --siblings <../a,../b>        Neighbouring repos that are read-only for agents (default: none; scan suggests)
  --base-branch <name>          Default: origin/HEAD, else main
  --branch-prefix <prefix>      Default: agent/
  --force                       Overwrite docs that exist without managed markers

Profiles:
  strict     re-run every check on stop; tests required; rm -r, secret reads and inline scripts denied
  balanced   re-run checks only when not honestly green; review + docs-sync gates; risky commands ask (default)
  light      guards for secrets / git / hook machinery; checks must pass; no review or docs nudges; rm -r allowed

Examples:
  npx agent-ready init                                  # wizard
  npx agent-ready init -y --runtime claude --profile strict
  npx agent-ready init -y --only hooks,docs --no-review
  npx agent-ready config set strictness.rmRecursive deny
`;

const VALUE_FLAGS = new Set(['--preset', '--runtime', '--to', '--siblings', '--base-branch', '--branch-prefix', '--profile', '--only', '--skip', '--check', '--protected-branches']);
function parseArgs(argv) {
  const args = { _: [], runtimes: [], checks: [] };
  const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.has(a) && (argv[i + 1] === undefined || argv[i + 1].startsWith('--'))) { console.error(`${a} needs a value.`); process.exit(1); }
    if (a === '--json') args.json = true;
    else if (a === '--force') args.force = true;
    else if (a === '--docs') args.docs = true;
    else if (a === '--no-run') args.noRun = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--interactive' || a === '-i') args.interactive = true;
    else if (a === '--require-tests') args.requireTests = true;
    else if (a === '--no-review') args.noReview = true;
    else if (a === '--no-docs-sync') args.noDocsSync = true;
    else if (a === '--no-siblings') args.siblings = [];
    else if (a === '--preset') args.preset = argv[++i];
    else if (a === '--profile') args.profile = argv[++i];
    else if (a === '--runtime') args.runtimes.push(...list(argv[++i]));
    else if (a === '--only') args.only = list(argv[++i]);
    else if (a === '--skip') args.skip = list(argv[++i]);
    else if (a === '--check') args.checks.push(argv[++i]);
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--siblings') args.siblings = list(argv[++i]);
    else if (a === '--protected-branches') args.protectedBranches = list(argv[++i]);
    else if (a === '--base-branch') args.baseBranch = argv[++i];
    else if (a === '--branch-prefix') args.branchPrefix = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a.startsWith('-')) { console.error(`Unknown option ${a}.\n`); process.stdout.write(HELP); process.exit(1); }
    else args._.push(a);
  }
  return args;
}

const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);

function printProfile(p) {
  const s = p.stack;
  console.log(`\n${s.name} — ${s.summary.join(', ')}`);
  console.log(`  preset: ${p.preset}   ecosystems: ${s.ecosystems.join('+')}   ci: ${s.ci || 'none'}   tests: ${p.tests.count}   files: ${p.files.count}`);
  console.log(`  checks: lint=${s.checks.lint || '—'} | types=${s.checks.typeCheck || '—'} | test=${s.checks.test || '—'}`);
  if (s.existingAgentDocs.length) console.log(`  existing agent docs: ${s.existingAgentDocs.join(', ')}`);
  if (p.siblings.length) console.log(`  sibling repos (read-only candidates): ${p.siblings.join(', ')}`);
  console.log('\nRisk zones (human-only candidates):');
  if (!p.risks.length) console.log('  none detected');
  for (const r of p.risks) console.log(`  - ${pad(r.label, 34)} ${[...r.deps, ...r.paths.slice(0, 3)].join(', ')}`);
  console.log('\nFragile zones (from git churn, 18 months):');
  if (!p.fragile.available) console.log('  git history unavailable');
  else if (!p.fragile.zones.length) console.log('  none above threshold');
  for (const z of p.fragile.zones) console.log(`  - ${pad(z.dir, 40)} ${z.commits} commits, ${z.fixes} fixes, ${z.authors} authors`);
  if (p.warnings.length) { console.log('\nWarnings:'); for (const w of p.warnings) console.log(`  ! ${w}`); }
  console.log('');
}

// ---------- init wizard ----------
async function wizard(root, args, cmd) {
  const Pm = require('../src/prompt');
  const { scan } = require('../src/scan');
  const { listPresets, getPreset } = require('../src/presets');
  const { adapters, RUNTIME_IDS } = require('../src/adapters');
  const { PROFILES, COMPONENTS } = require('../src/profiles');
  const { detectedRuntimes, detectBaseBranch, previousConfig } = require('../src/init');
  const prev = cmd === 'refresh' ? previousConfig(root) : null;
  const profile = scan(root);

  console.log(`\n${Pm.bold('agent-ready')} — ${profile.stack.summary.join(', ')}`);
  console.log(Pm.dim(`  checks: ${[profile.stack.checks.lint, profile.stack.checks.typeCheck].filter(Boolean).join(' && ') || 'none detected'}   risk zones: ${profile.risks.length}   fragile zones: ${profile.fragile.zones.length}`));
  for (const w of profile.warnings) console.log(Pm.dim(`  ! ${w}`));

  const preset = await Pm.select('Stack preset', listPresets().map((id) => ({ id, label: id, hint: getPreset(id).label })), args.preset || (prev && prev.preset) || profile.preset);

  const detected = detectedRuntimes(root);
  const rtDefault = args.runtimes.length ? args.runtimes : (prev && prev.runtimes) || (detected.length ? detected : ['cursor', 'claude']);
  const runtimes = await Pm.multiselect('Agent runtimes to configure', RUNTIME_IDS.map((id) => ({ id, label: adapters[id].label, hint: [detected.includes(id) ? 'detected' : null, adapters[id].experimental ? 'experimental' : null].filter(Boolean).join(', ') })), rtDefault);
  if (!runtimes.length) { console.error('\nAt least one runtime is needed.'); process.exit(1); }

  const profileId = await Pm.select('Strictness profile', Object.entries(PROFILES).map(([id, p]) => ({ id, label: p.label, hint: p.hint })), args.profile || (prev && prev.profile) || 'balanced');

  const compDefault = args.only || (prev && prev.components) || COMPONENTS.filter((c) => c.default).map((c) => c.id);
  const components = await Pm.multiselect('Components to install', COMPONENTS.map((c) => ({ id: c.id, label: c.label, hint: c.hint })), compDefault.filter((c) => !(args.skip || []).includes(c)));

  let siblings = args.siblings != null ? args.siblings : (prev && prev.siblings) || [];
  if (profile.siblings.length && args.siblings == null) {
    siblings = await Pm.multiselect('Neighbouring repositories that agents may READ but never write', profile.siblings.map((s) => ({ id: s, label: s })), siblings);
  }
  const baseBranch = await Pm.text('Base branch (agents never push to it directly)', args.baseBranch || (prev && prev.baseBranch) || detectBaseBranch(root));
  const branchPrefix = await Pm.text('Branch prefix for agent work', args.branchPrefix || (prev && prev.branchPrefix) || 'agent/');
  Pm.close();
  return { ...args, preset, runtimes, profile: profileId, components, siblings, baseBranch, branchPrefix };
}

function summarise(cmd, result) {
  const { profile, cfg, preset, adapters, report, dry } = result;
  console.log(`\nagent-ready ${cmd}${dry ? ' (dry run — nothing written)' : ''}: ${profile.stack.summary.join(', ')} → preset "${preset.id}"${cfg.layers.length ? ' + ' + cfg.layers.join(', ') : ''}${cfg.modules.length ? ' + ' + cfg.modules.join(', ') : ''}; runtimes: ${adapters.map((a) => a.label).join(', ')}; profile: ${cfg.profile}; components: ${cfg.components.join(', ')}\n`);
  for (const r of report) console.log(`  ${pad(r.status, 13)} ${r.file}`);
  if (profile.warnings.length) { console.log('\nWarnings:'); for (const w of profile.warnings) console.log(`  ! ${w}`); }
  if (cfg.components.includes('hooks')) console.log(`\nEnforced: ${cfg.checks.length ? cfg.checks.map((c) => c.command).join(' && ') : '(no checks yet)'} on stop; review gate ${cfg.gates.review ? 'on' : 'off'}; docs-sync gate ${cfg.gates.docsSync ? 'on' : 'off'}; ${cfg.denyWrite.length} protected path patterns; parsed git/rm/redirects + ${cfg.denyShell.length} shell rules.`);
  else console.log('\nHooks not installed — nothing is enforced. `npx agent-ready refresh --only hooks` adds them.');
  if (profile.siblings.length && !cfg.siblings.length) console.log(`Neighbouring repos detected (${profile.siblings.join(', ')}). To make them read-only for agents: npx agent-ready refresh --siblings ${profile.siblings.slice(0, 2).join(',')}`);
  if (!dry) {
    console.log('Next: npx agent-ready doctor   — prove the guards fire');
    console.log('      fill the TODO(agent-ready) sections in CLAUDE.md and docs/*.md, or ask your agent: "finish the agent-ready setup" (npx agent-ready skill installs the skill).');
    console.log('      change a knob later: npx agent-ready config set <key> <value>\n');
  } else console.log('');
}

function configCmd(root, args) {
  const file = path.join(root, '.agent-ready', 'config.json');
  if (!fs.existsSync(file)) { console.error('Not initialised — run `npx agent-ready init` first.'); process.exit(1); }
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const [sub, key, ...rest] = args._;
  const get = (obj, k) => k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), obj);
  if (sub === 'get' || !sub) {
    const v = key ? get(cfg, key) : cfg;
    if (v === undefined) { console.error(`No such key: ${key}`); process.exit(1); }
    process.stdout.write(JSON.stringify(v, null, 2) + '\n');
    return;
  }
  if (sub === 'set') {
    if (!key || !rest.length) { console.error('Usage: agent-ready config set <key> <value>'); process.exit(1); }
    const raw = rest.join(' ');
    let value; try { value = JSON.parse(raw); } catch { value = raw; }
    const parts = key.split('.');
    let o = cfg;
    for (const p of parts.slice(0, -1)) { if (typeof o[p] !== 'object' || o[p] === null) o[p] = {}; o = o[p]; }
    const last = parts[parts.length - 1];
    if (get(cfg, key) === undefined && !['gates', 'strictness', 'checks', 'siblings', 'protectedBranches', 'allowOutsideRoot', 'denyWrite', 'denyRead', 'denyShell'].includes(parts[0])) console.error(`(new key ${key} — hooks ignore keys they do not know)`);
    o[last] = value;
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
    console.log(`${key} = ${JSON.stringify(value)}   (hooks read the config on every call — no restart; run \`npx agent-ready doctor\` to verify)`);
    return;
  }
  console.error('Usage: agent-ready config get [key] | set <key> <value>'); process.exit(1);
}

function runtimesCmd(root) {
  const { adapters } = require('../src/adapters');
  const { detectedRuntimes } = require('../src/init');
  const detected = detectedRuntimes(root);
  console.log('');
  for (const a of Object.values(adapters)) {
    console.log(`  ${pad(a.id, 9)} ${pad(a.label, 16)} ${detected.includes(a.id) ? 'detected ' : '         '} ${a.experimental ? 'experimental' : 'verified    '}  hooks → ${a.hooksFile}; rules → ${a.rulesPath}/${a.commandsPath ? '; commands → ' + a.commandsPath + '/' : ''}`);
  }
  console.log(`\nDefault for init: ${detected.length ? detected.join(', ') : 'cursor, claude (nothing detected)'}. Choose with --runtime <id> or in the wizard.\n`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (!cmd || args.help || cmd === 'help') { process.stdout.write(HELP); return; }
  const firstIsDir = args._[0] && fs.existsSync(args._[0]) && fs.statSync(args._[0]).isDirectory() && (cmd !== 'triage' || args._.length > 1) && cmd !== 'config';
  if (!['triage', 'presets', 'config', 'runtimes'].includes(cmd) && args._[0] && !firstIsDir && /[\/\\]/.test(args._[0])) { console.error(`Directory not found: ${args._[0]}`); process.exit(1); }
  const root = path.resolve(firstIsDir ? args._.shift() : process.cwd());

  switch (cmd) {
    case 'scan': {
      const { scan } = require('../src/scan');
      const profile = scan(root);
      if (args.json) process.stdout.write(JSON.stringify(profile, null, 2) + '\n'); else printProfile(profile);
      return;
    }
    case 'init':
    case 'refresh': {
      const { run } = require('../src/init');
      const { listPresets } = require('../src/presets');
      const { RUNTIME_IDS } = require('../src/adapters');
      const { PROFILES, COMPONENTS } = require('../src/profiles');
      const Pm = require('../src/prompt');
      if (args.preset && !listPresets().includes(args.preset)) { console.error(`Unknown preset "${args.preset}". Known: ${listPresets().join(', ')}`); process.exit(1); }
      for (const r of args.runtimes) if (!RUNTIME_IDS.includes(r)) { console.error(`Unknown runtime "${r}". Known: ${RUNTIME_IDS.join(', ')}`); process.exit(1); }
      if (args.profile && !PROFILES[args.profile]) { console.error(`Unknown profile "${args.profile}". Known: ${Object.keys(PROFILES).join(', ')}`); process.exit(1); }
      const compIds = COMPONENTS.map((c) => c.id);
      for (const c of [...(args.only || []), ...(args.skip || [])]) if (!compIds.includes(c)) { console.error(`Unknown component "${c}". Known: ${compIds.join(', ')}`); process.exit(1); }
      let opts = { ...args };
      const wantWizard = args.interactive || (cmd === 'init' && !args.yes && Pm.isInteractive() && !args.dryRun);
      if (wantWizard) opts = await wizard(root, args, cmd);
      else if (args.only || args.skip) {
        const base = args.only || COMPONENTS.filter((c) => c.default).map((c) => c.id);
        opts.components = base.filter((c) => !(args.skip || []).includes(c));
      }
      opts.checks = args.checks.length ? args.checks.map((c, i) => ({ id: `check${i + 1}`, command: c })) : null;
      if (args.noReview || args.noDocsSync) opts.gates = { ...(args.noReview ? { review: false } : {}), ...(args.noDocsSync ? { docsSync: false } : {}) };
      let result;
      try { result = run(root, opts); } catch (e) { console.error(`\nagent-ready ${cmd} failed: ${e.message}\n`); process.exit(1); }
      summarise(cmd, result);
      return;
    }
    case 'check': { const { check } = require('../src/check'); process.exit(check(root, { runChecks: !args.noRun }) ? 0 : 1); }
    // eslint-disable-next-line no-fallthrough
    case 'doctor': { const { doctor } = require('../src/doctor'); process.exit(doctor(root, { verbose: !!args.verbose }) ? 0 : 1); }
    // eslint-disable-next-line no-fallthrough
    case 'triage': {
      const { triage, format } = require('../src/triage');
      const text = args._.join(' ').trim();
      if (!text) { console.error('Usage: agent-ready triage "<task text>"'); process.exit(1); }
      const r = triage(root, text);
      if (args.json) process.stdout.write(JSON.stringify(r, null, 2) + '\n'); else console.log(format(r));
      process.exit(r.verdict === 'auto' ? 0 : r.verdict === 'needs-ac' ? 2 : 3);
    }
    // eslint-disable-next-line no-fallthrough
    case 'config': configCmd(root, args); return;
    case 'runtimes': runtimesCmd(root); return;
    case 'skill': {
      const { installSkill } = require('../src/skill');
      const where = installSkill(root, args.to);
      console.log(`\nSkill installed to ${where}\nTell your agent: "Finish the agent-ready setup for this repository using the agent-ready skill."\n`);
      return;
    }
    case 'presets': {
      const { listPresets, getPreset } = require('../src/presets');
      console.log('');
      for (const id of listPresets()) { const p = getPreset(id); console.log(`  ${pad(id, 12)} ${p.label}\n  ${' '.repeat(12)} ${p.description}`); }
      console.log('');
      return;
    }
    case 'uninstall': {
      const { uninstall } = require('../src/uninstall');
      const removed = uninstall(root, { docs: !!args.docs });
      console.log(removed.length ? `\nRemoved:\n${removed.map((r) => '  - ' + r).join('\n')}\n` : '\nNothing to remove.\n');
      if (!args.docs) console.log('AGENTS.md, CLAUDE.md and docs/ were kept (they are yours). Use --docs to strip the managed blocks too.\n');
      return;
    }
    default:
      console.error(`Unknown command "${cmd}".\n`); process.stdout.write(HELP); process.exit(1);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });

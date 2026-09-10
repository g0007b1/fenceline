'use strict';
// check: is the setup wired and are the gates runnable?
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getAdapters } = require('./adapters');
const { HOOK_SCRIPTS } = require('./init');

function check(root, { runChecks = true } = {}) {
  let ok = true;
  const say = (good, msg) => { console.log(`  ${good ? 'ok  ' : 'FAIL'} ${msg}`); if (!good) ok = false; };
  const warn = (msg) => console.log(`  warn ${msg}`);
  console.log('\nfenceline check\n');
  const cfgPath = path.join(root, '.fenceline', 'config.json');
  say(fs.existsSync(cfgPath), '.fenceline/config.json present');
  if (!fs.existsSync(cfgPath)) { console.log('\nRun `npx fenceline init` first.\n'); return false; }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  if (cfg.version !== 2) warn(`config version ${cfg.version} — run \`npx fenceline refresh\` to upgrade`);
  for (const f of HOOK_SCRIPTS) say(fs.existsSync(path.join(root, '.fenceline', 'hooks', f)), `hook script ${f}`);
  for (const a of getAdapters(cfg.runtimes)) {
    if (a.enforces) say(a.isWired(root), `${a.label} hooks wired`);
    else warn(`${a.label}: no hook API — gates are convention only`);
  }
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'docs/agent-safe-tasks.md', 'docs/README.md']) say(fs.existsSync(path.join(root, f)), `${f} present`);
  const todo = ['CLAUDE.md', 'docs/README.md', ...fs.existsSync(path.join(root, 'docs')) ? fs.readdirSync(path.join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => 'docs/' + f) : []]
    .filter((f, i, arr) => arr.indexOf(f) === i && fs.existsSync(path.join(root, f)) && fs.readFileSync(path.join(root, f), 'utf8').includes('TODO(fenceline)'));
  if (todo.length) warn(`unfilled TODO(fenceline) sections in: ${todo.join(', ')} — run /fenceline-domain-doc or fill by hand`);
  if (!cfg.checks.length) warn('no lint / type-check commands configured — the stop-hook cannot enforce anything. See `fenceline scan` warnings.');
  for (const c of cfg.checks) {
    if (!runChecks) { console.log(`  skip ${c.command} (${c.id}) — --no-run`); continue; }
    const r = spawnSync(c.command, { cwd: root, shell: true, stdio: 'pipe', encoding: 'utf8', timeout: 10 * 60 * 1000 });
    say(r.status === 0, `${c.command} exits 0 (${c.id})`);
    if (r.status !== 0) console.log('       ' + String(r.stdout + r.stderr).trim().split('\n').slice(-5).join('\n       '));
  }
  console.log(ok ? '\nAll good.\n' : '\nFix the failures above; hooks depend on them.\n');
  return ok;
}

module.exports = { check };

'use strict';
// prove: doctor (synthetic payloads) + a canary task through the real runtime with hooks live.
// The canary must be stopped by the stop hook and denied when it tries to write .env.
const fs = require('fs');
const path = require('path');
const { doctor } = require('../doctor');
const R = require('../render');

async function run(root, runner, opts) {
  const log = opts.log || (() => {});
  const summary = { doctor: null, canary: null };
  // 1. doctor, quietly
  const origLog = console.log; let buf = '';
  console.log = (s) => { buf += s + '\n'; };
  try { summary.doctor = doctor(root, { verbose: false }); } finally { console.log = origLog; }
  log(`  ${summary.doctor ? '✓' : '✖'} doctor: ${summary.doctor ? 'guards behave as configured' : 'some guards FAILED — see `npx fenceline doctor`'}`);
  if (runner.id === 'fake') { summary.canary = { skipped: 'fake runner' }; return { ok: true, costUsd: 0, summary }; }
  // 2. canary through the runtime (only for runtimes we configured hooks for)
  if (!opts.targets.includes(runner.id)) { summary.canary = { skipped: `hooks not configured for ${runner.id}` }; log(`  · canary skipped: hooks not configured for ${runner.label}`); return { ok: true, costUsd: 0, summary }; }
  const canaryFile = 'docs/README.md';
  const stamp = Date.now();
  const before = fs.existsSync(path.join(root, canaryFile)) ? fs.readFileSync(path.join(root, canaryFile), 'utf8') : null;
  const auditPath = path.join(root, '.fenceline', 'audit.log');
  const auditBefore = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf8').length : 0;
  log('▸ canary: running a harmless task through ' + runner.label + ' with hooks live …');
  const r = await runner.run({
    phase: 'canary', cwd: root, permissionMode: 'acceptEdits', maxTurns: 12, maxBudgetUsd: 1, includeHookEvents: true, model: opts.model, noPersist: true,
    allowedTools: ['Read', 'Edit', 'Write', 'Bash'],
    prompt: R.render(fs.readFileSync(path.join(__dirname, 'prompts', 'canary.md'), 'utf8'), { canaryFile, stamp }),
  });
  const audit = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf8').slice(auditBefore) : '';
  const envDenied = /"decision":"deny"[^\n]*\.env/.test(audit) || /env-write=denied/.test(r.text || '');
  const stopFired = r.events.some((e) => /Stop/.test(JSON.stringify(e.hook_event_name || e.hookEventName || e.event || '')) && /block|followup|checks|review/i.test(JSON.stringify(e)));
  const line = (r.text || '').split('\n').find((l) => l.startsWith('CANARY:')) || '';
  summary.canary = { ok: r.ok, envDenied, stopFired, line, costUsd: r.costUsd, turns: r.turns };
  // clean the canary line
  if (before != null) fs.writeFileSync(path.join(root, canaryFile), before);
  const envPath = path.join(root, '.env');
  if (fs.existsSync(envPath)) { const e = fs.readFileSync(envPath, 'utf8'); if (e.includes('FENCELINE_CANARY')) fs.writeFileSync(envPath, e.replace(/\n?FENCELINE_CANARY=1\n?/g, '\n')); }
  log(`  ${envDenied ? '✓' : '✖'} canary: .env write ${envDenied ? 'denied by the hook' : 'NOT denied'}; stop hook ${stopFired ? 'sent the agent back for checks/review' : 'did not fire (check hook wiring)'}${line ? ' — ' + line : ''}`);
  return { ok: r.ok, costUsd: r.costUsd, summary };
}

module.exports = { run };

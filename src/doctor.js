'use strict';
// doctor: prove the guards work without an agent in the loop.
//   1. Dry-run guard-write / guard-read / guard-shell against preset samples, bypass regressions and this repo's config.
//   2. Simulate a full session through the stop-hook state machine on a scratch state file.
//   3. Prove fail-closed behaviour on a corrupted config (in a scratch copy).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { getPreset } = require('./presets');

function runHook(root, script, input, extraEnv) {
  const r = spawnSync('node', [path.join(root, '.agent-ready', 'hooks', script), '--runtime', 'cursor', '--root', root], {
    cwd: root, input: JSON.stringify({ ...input, workspace_roots: [root], conversation_id: 'doctor' }), encoding: 'utf8', env: { ...process.env, ...(extraEnv || {}) },
  });
  return (r.stdout || '').trim();
}
const decision = (out) => (out.includes('"deny"') ? 'deny' : out.includes('"ask"') ? 'ask' : 'allow');

function doctor(root, { verbose = false } = {}) {
  console.log('\nagent-ready doctor\n');
  const cfgPath = path.join(root, '.agent-ready', 'config.json');
  if (!fs.existsSync(cfgPath)) { console.log('  not initialised — run `npx agent-ready init` first\n'); return false; }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const preset = getPreset(cfg.preset, { layers: cfg.layers || [], modules: cfg.modules || [] });
  let ok = true, total = 0;
  const line = (pass, label, got) => { total += 1; if (pass && !verbose) return; console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${label}${got ? ` (got ${got})` : ''}`); if (!pass) ok = false; };

  console.log('Guards (preset samples + bypass regressions):');
  const cases = [];
  const W = (p, expect, label) => cases.push(['guard-write.js', { tool_name: 'Write', tool_input: { file_path: path.join(root, p) } }, expect, label || `write ${p}`]);
  const R = (p, expect, label) => cases.push(['guard-read.js', { tool_name: 'Read', tool_input: { file_path: path.join(root, p) } }, expect, label || `read ${p}`]);
  const S = (c, expect, label) => cases.push(['guard-shell.js', { tool_name: 'Bash', tool_input: { command: c } }, expect, label || `shell: ${c}`]);
  for (const p of preset.doctor.denyPaths) W(p, 'deny');
  for (const p of preset.doctor.allowPaths) W(p, 'allow');
  R('.env', 'deny'); R('.env.example', 'allow'); R('README.md', 'allow');
  for (const c of preset.doctor.denyShell) S(c, 'deny');
  for (const c of preset.doctor.askShell || []) S(c, 'ask');
  for (const c of preset.doctor.allowShell) S(c, 'allow');
  for (const c of cfg.checks) S(c.command, 'allow');
  for (const sib of cfg.siblings || []) {
    W(path.join(sib, 'README.md'), 'deny', `write ${sib}/README.md (sibling)`);
    S(`cat ${sib}/README.md`, 'allow', `shell: cat ${sib}/README.md (read-only)`);
    S(`echo x > ${sib}/notes.md`, 'deny', `shell: write into ${sib}`);
    S(`cd ${sib} && git commit -m x`, 'deny', `shell: cd ${sib} && git commit`);
    S(`cd .. && cd ${path.basename(sib)} && echo x > f`, 'deny', `shell: cd chain into ${sib}`);
    S(`(cd ${sib} && git log -1)`, 'allow', `shell: (cd ${sib} && git log)`);
  }
  // symlink bypass: link → sibling / secret
  const linkDir = path.join(root, '.agent-ready', 'doctor-link');
  try { fs.rmSync(linkDir, { force: true }); fs.symlinkSync(path.join(root, '.env'), linkDir); W('.agent-ready/doctor-link', 'deny', 'write through a symlink to .env'); } catch { /* symlinks unavailable */ }
  for (const [script, input, expect, label] of cases) {
    const got = decision(runHook(root, script, input));
    line(got === expect || (expect === 'deny' && got === 'ask' && !/sibling|symlink/.test(label)), label, got !== expect ? got : null);
  }
  try { fs.rmSync(linkDir, { force: true }); } catch { /* ignore */ }

  console.log('\nSession simulation (scratch state, live state untouched):');
  const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ready-doctor-')), 'state.json');
  const env = { AGENT_READY_STATE_FILE: stateFile };
  const codeFile = { node: 'src/x.ts', python: 'app/x.py', go: 'internal/x.go', rust: 'src/x.rs' }[cfg.ecosystem] || 'src/x.c';
  runHook(root, 'session-start.js', {}, env);
  runHook(root, 'track-edit.js', { tool_name: 'Edit', tool_input: { file_path: path.join(root, codeFile) } }, env);
  // Stop runs the checks itself: green → asks for review; red → sends back with output.
  let out = runHook(root, 'ensure-checks.js', { status: 'completed' }, env);
  if (!cfg.checks.length) line(out.includes('review ONLY'), 'stop-hook demands self-review (no checks configured)', out ? null : 'nothing');
  else if (/checks fail/.test(out)) {
    line(true, 'stop-hook ran the checks itself after a code edit and they are red → agent sent back (fix them, then re-run doctor)');
    for (const c of cfg.checks) runHook(root, 'track-checks.js', { tool_name: 'Bash', tool_input: { command: c.command }, exit_code: 0 }, env);
    fs.writeFileSync(path.join(root, '.agent-ready', 'config.json'), JSON.stringify({ ...cfg, runChecksOnStop: 'never' }, null, 2));
    out = runHook(root, 'ensure-checks.js', { status: 'completed' }, env);
    fs.writeFileSync(path.join(root, '.agent-ready', 'config.json'), JSON.stringify(cfg, null, 2) + '\n');
    line(out.includes('review ONLY'), 'stop-hook demands self-review once checks are green', out ? null : 'nothing');
  } else line(out.includes('review ONLY'), 'stop-hook ran the checks itself after a code edit (green) and demands self-review', out ? null : 'nothing');
  out = runHook(root, 'ensure-checks.js', { status: 'completed' }, env);
  line(out === '', 'stop-hook releases the agent after the review', out ? 'follow-up' : null);
  // dishonest green: `npm run lint || true` must not count
  runHook(root, 'track-edit.js', { tool_name: 'Edit', tool_input: { file_path: path.join(root, codeFile) } }, env);
  if (cfg.checks[0]) {
    runHook(root, 'track-checks.js', { tool_name: 'Bash', tool_input: { command: `${cfg.checks[0].command} || true` }, exit_code: 0 }, env);
    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    line(st.checks[cfg.checks[0].id] !== 'green', '`<check> || true` does not count as green');
    runHook(root, 'track-checks.js', { tool_name: 'Bash', tool_input: { command: `echo ${cfg.checks[0].command}` }, exit_code: 0 }, env);
    line(JSON.parse(fs.readFileSync(stateFile, 'utf8')).checks[cfg.checks[0].id] !== 'green', '`echo <check>` does not count as green');
  }
  // compaction must not wipe state
  runHook(root, 'session-start.js', { source: 'compact' }, env);
  line(JSON.parse(fs.readFileSync(stateFile, 'utf8')).editedFiles.length === 1, 'SessionStart(compact) keeps the session state');
  runHook(root, 'session-start.js', { source: 'startup' }, env);
  line(JSON.parse(fs.readFileSync(stateFile, 'utf8')).editedFiles.length === 0, 'SessionStart(startup) resets the session state');
  fs.rmSync(path.dirname(stateFile), { recursive: true, force: true });

  console.log('\nFail-closed on a broken config (scratch copy):');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-ready-broken-'));
  fs.cpSync(path.join(root, '.agent-ready'), path.join(scratch, '.agent-ready'), { recursive: true });
  fs.writeFileSync(path.join(scratch, '.agent-ready', 'config.json'), 'not json');
  line(decision(runHook(scratch, 'guard-write.js', { tool_name: 'Write', tool_input: { file_path: path.join(scratch, 'README.md') } })) === 'deny', 'unparsable config denies every edit');
  line(decision(runHook(scratch, 'guard-shell.js', { tool_name: 'Bash', tool_input: { command: 'ls' } })) === 'deny', 'unparsable config denies every shell command');
  fs.rmSync(scratch, { recursive: true, force: true });

  console.log(ok ? `\n${total} checks — guards behave as configured.\n` : `\n${total} checks — some guards did not behave as expected, see FAIL lines.\n`);
  return ok;
}

module.exports = { doctor };

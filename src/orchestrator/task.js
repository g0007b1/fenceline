'use strict';
// fenceline task "<text>": run one business task through an agent runtime with the guardrails live.
//   triage → branch from base → agent works (hooks deny / log / gate) → checks re-run by code → commit → draft PR
// The agent never commits or pushes; fenceline does, so the branch and PR shape are deterministic.
const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const { triage } = require('../triage');
const R = require('../render');

const sh = (cmd, cwd, opts = {}) => execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const tryS = (cmd, cwd) => { try { return sh(cmd, cwd); } catch { return null; } };

function slugify(text) {
  const s = text.toLowerCase().replace(/[`'"]/g, '').replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '').split('-').filter(Boolean).slice(0, 6).join('-');
  return (s || 'task').slice(0, 48);
}

function loadConfig(root) {
  const p = path.join(root, '.fenceline', 'config.json');
  if (!fs.existsSync(p)) throw new Error('No .fenceline/config.json — run `fenceline init` first so the guardrails exist before an agent works here.');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const { errorLines } = require('../../hooks/lib/state');
function runChecks(root, checks, timeoutMs, baseline) {
  return checks.map((c) => {
    const started = Date.now();
    const r = spawnSync(c.command, { cwd: root, shell: true, encoding: 'utf8', timeout: timeoutMs || 180000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
    const errs = errorLines(out);
    const base = baseline && baseline.checks[c.id];
    const newErrors = base && base.failing ? errs.filter((l) => !base.errorLines.includes(l)) : errs;
    const preExisting = !!(base && base.failing && r.status !== 0 && !newErrors.length);
    return { id: c.id, command: c.command, passed: r.status === 0 || preExisting, exit: r.status, preExisting, newErrors: r.status === 0 ? [] : newErrors.slice(0, 20), errorLines: errs, ms: Date.now() - started, tail: out.split('\n').slice(-12).join('\n') };
  });
}
// Run the checks on the untouched base so pre-existing failures are known before the agent starts.
function writeBaseline(root, checks, timeoutMs) {
  const results = runChecks(root, checks, timeoutMs, null);
  const b = { at: new Date().toISOString(), checks: {} };
  for (const r of results) b.checks[r.id] = { failing: r.exit !== 0, errorLines: r.errorLines.slice(0, 200) };
  fs.mkdirSync(path.join(root, '.fenceline', 'state'), { recursive: true });
  fs.writeFileSync(path.join(root, '.fenceline', 'state', 'baseline.json'), JSON.stringify(b, null, 2));
  return { results, baseline: b };
}

// Facts from the hook event stream: how often the guardrails intervened.
function hookStats(events) {
  const st = { denied: [], asked: [], stopBlocks: 0, hookEvents: 0 };
  const short = (r) => String(r || '').replace(/^fenceline:\s*/, '').replace(/\s+/g, ' ').slice(0, 140);
  for (const e of events || []) {
    if (e.type !== 'system' || e.subtype !== 'hook_response') continue;
    st.hookEvents++;
    const out = String(e.output || '');
    const name = String(e.hook_name || e.hook_event || '');
    let j = null; try { j = JSON.parse(out); } catch { j = null; }
    const hs = (j && j.hookSpecificOutput) || {};
    const decision = hs.permissionDecision || (j && j.decision) || (/"permissionDecision":"deny"|"decision":"deny"/.test(out) ? 'deny' : /"permissionDecision":"ask"/.test(out) ? 'ask' : null);
    const reason = hs.permissionDecisionReason || (j && j.reason) || '';
    if (decision === 'deny') st.denied.push(short(reason) || name);
    else if (decision === 'ask') st.asked.push(short(reason) || name);   // in headless mode an "ask" is a denial the agent must route around
    if (/^Stop/.test(name) && (decision === 'block' || /followup_message/.test(out))) st.stopBlocks++;
  }
  return st;
}

function prBody(rep) {
  const L = [];
  L.push(`## Task`, '', rep.task, '', `## Summary`, '', rep.result.summary || '_(no summary)_', '');
  L.push(`## How to test`, '', ...(rep.result.howToTest || []).map((s, i) => `${i + 1}. ${s}`), '');
  L.push(`## Checks (re-run by fenceline after the agent finished)`, '', ...rep.checks.map((c) => `- ${c.passed ? '✅' : '❌'} \`${c.command}\`${c.preExisting ? ' — already failing on the base branch, no new errors' : c.passed ? '' : ` — ${(c.newErrors || []).length} new error line(s)`}`), '');
  if (rep.result.blockers && rep.result.blockers.length) L.push(`## Blockers`, '', ...rep.result.blockers.map((b) => `- ${b}`), '');
  if (rep.result.openQuestions && rep.result.openQuestions.length) L.push(`## Open questions`, '', ...rep.result.openQuestions.map((q) => `- ${q}`), '');
  L.push(`## Guardrails`, '', `- triage: **${rep.triage.verdict}** (${rep.triage.reasons.slice(0, 3).join('; ')})`, `- writes / commands denied by hooks: ${rep.hooks.denied.length}${rep.hooks.denied.length ? ' — ' + rep.hooks.denied.slice(0, 3).join('; ') : ''}`, `- commands that would have asked a human (refused unattended): ${(rep.hooks.asked || []).length}${(rep.hooks.asked || []).length ? ' — ' + rep.hooks.asked.slice(0, 3).join('; ') : ''}`, `- times the stop hook sent the agent back for checks / review: ${rep.hooks.stopBlocks}`, `- agent: ${rep.agent}${rep.model ? ' (' + rep.model + ')' : ''}, ${rep.turns || '?'} turns, ≈ $${(rep.costUsd || 0).toFixed(2)}${rep.limited ? ', **cap reached**' : ''}`, '');
  L.push(`---`, `_Draft PR opened by [fenceline](https://github.com/g0007b1/fenceline) \`task\`. A human reviews and merges._`);
  return L.join('\n');
}

async function run(root, runner, text, opts = {}) {
  const log = opts.log || (() => {});
  const cfg = loadConfig(root);
  const rep = { task: text, agent: runner.id, model: opts.model || null, startedAt: new Date().toISOString(), triage: null, branch: null, base: null, result: null, checks: [], hooks: { denied: [], asked: [], stopBlocks: 0 }, commit: null, pr: null, costUsd: 0, turns: 0, limited: false, ok: false };

  // 0. preconditions: a git repo with a clean tracked tree; hooks wired for this runtime
  if (!fs.existsSync(path.join(root, '.git'))) throw new Error('Not a git repository — `fenceline task` needs a branch to work on.');
  const dirty = tryS('git status --porcelain -uno', root);
  if (dirty && !opts.allowDirty) throw new Error(`Working tree has uncommitted changes:\n${dirty.split('\n').slice(0, 8).join('\n')}\nCommit or stash them (or pass --allow-dirty).`);
  if (runner.id !== 'fake' && !(cfg.runtimes || []).includes(runner.id)) throw new Error(`Hooks are not configured for ${runner.label} in this repo (runtimes: ${(cfg.runtimes || []).join(', ')}). Run \`fenceline refresh --runtime ${runner.id}\` first.`);

  // 1. triage — the same rule the docs give the agent, applied before any spend
  rep.triage = triage(root, text);
  log(`  triage: ${rep.triage.verdict.toUpperCase()} — ${rep.triage.reasons.slice(0, 2).join('; ')}`);
  if (rep.triage.verdict === 'human' && !opts.force) throw new Error(`Triage says HUMAN — this task is outside what an agent should do unattended:\n${rep.triage.reasons.map((r) => '  - ' + r).join('\n')}\nRun with --force to override.`);
  if (rep.triage.verdict === 'needs-ac') log('  · triage: no acceptance criteria — the agent will state its assumptions; add Given/When/Then for better results');

  // 2. branch
  const original = tryS('git rev-parse --abbrev-ref HEAD', root) || 'HEAD';
  rep.base = opts.base || cfg.baseBranch || original;
  const prefix = cfg.branchPrefix || 'agent/';
  let branch = prefix + slugify(text);
  if (tryS(`git rev-parse --verify --quiet refs/heads/${branch}`, root)) branch += '-' + Date.now().toString(36).slice(-4);
  rep.branch = branch;
  const baseRef = tryS(`git rev-parse --verify --quiet ${rep.base}`, root) ? rep.base : original;
  sh(`git checkout -q -b ${branch} ${baseRef}`, root);
  log(`  branch: ${branch} (from ${baseRef})`);

  const restore = () => { try { sh(`git checkout -q ${original}`, root); } catch { /* leave as is */ } };
  try {
    // 3. the agent works with the hooks live (no disableAllHooks here — this is the real environment)
    const checks = (cfg.checks || []);
    const prompt = () => R.render(fs.readFileSync(path.join(__dirname, 'prompts', 'task.md'), 'utf8'), {
      baselineNote: rep.baseline && rep.baseline.some((b) => !b.passed) ? ` Note: ${rep.baseline.filter((b) => !b.passed).map((b) => b.id).join(', ')} already fail on the base branch before your change; those pre-existing errors are not yours to fix (they may live in protected paths) — only new errors count.` : '',
      task: text, branch, base: rep.base,
      checks: checks.length ? checks.map((c) => '`' + c.command + '`').join(', ') : 'none configured',
      docsHint: rep.triage.domainDocs.length ? ` (${rep.triage.domainDocs.filter((d) => fs.existsSync(path.join(root, d))).join(', ') || 'docs/README.md'})` : ' (see docs/README.md)',
    });
    // baseline: which checks already fail here? Those are reported, not blamed on the agent, and the stop hook knows too.
    let baseline = null;
    if (checks.length && !opts.skipChecks) {
      const b = writeBaseline(root, checks, cfg.checkTimeoutMs); baseline = b.baseline; rep.baseline = b.results.map((r) => ({ id: r.id, passed: r.exit === 0, errors: r.errorLines.length }));
      const failing = b.results.filter((r) => r.exit !== 0);
      log(failing.length ? `  · baseline: ${failing.map((r) => `${r.command} already fails (${r.errorLines.length} error lines) — only new errors will count`).join('; ')}` : `  ✓ baseline: ${checks.map((c) => c.command).join(', ')} pass on ${rep.base}`);
    }
    log(`▸ agent: ${runner.label} working with hooks live (max ${opts.maxTurns || 80} turns, $${opts.budget || 6} cap) …`);
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'schemas', 'task.json'), 'utf8'));
    const r = await runner.run({
      phase: 'task', cwd: root, prompt: prompt(), schema, permissionMode: 'acceptEdits', includeHookEvents: true, model: opts.model, effort: opts.effort,
      maxTurns: opts.maxTurns || 80, maxBudgetUsd: opts.budget || 6, noPersist: false,
      allowedTools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'], disallowedTools: ['Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git checkout:*)', 'Bash(git switch:*)', 'Bash(git branch:*)'],
      timeoutMs: opts.timeoutMs || 45 * 60 * 1000,
      onEvent: opts.onEvent,
    });
    rep.costUsd = r.costUsd || 0; rep.turns = r.turns || 0; rep.limited = !!r.limited; rep.sessionId = r.sessionId;
    rep.hooks = hookStats(r.events);
    rep.result = r.json || { summary: (r.text || '').slice(0, 2000), howToTest: [], filesChanged: [], checksRun: [], blockers: r.ok ? [] : [`agent did not finish cleanly: ${r.stderr || r.text || 'no output'}`.slice(0, 500)], openQuestions: [] };
    if (r.authFail) throw new Error(runner.authHint());
    log(`  ${r.ok ? '✓' : '✖'} agent finished — ${rep.turns} turns, $${rep.costUsd.toFixed(2)}${rep.limited ? ' (cap reached)' : ''}; hooks: ${rep.hooks.denied.length} denied, ${rep.hooks.asked.length} would-ask, stop hook intervened ${rep.hooks.stopBlocks}×`);

    // 4. what changed?
    let porcelain = ''; try { porcelain = execSync('git status --porcelain', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { porcelain = ''; }
    const changed = porcelain.split('\n').filter(Boolean).map((l) => l.replace(/^.{2} /, '').replace(/^.* -> /, '')).filter((p) => !/^\.fenceline\/(state|logs|audit)/.test(p));
    rep.filesChanged = changed;
    if (!changed.length) { log('  · the agent changed nothing — no commit, no PR'); rep.ok = false; restore(); tryS(`git branch -D ${branch}`, root); rep.branch = null; return rep; }
    log(`  changed: ${changed.slice(0, 6).join(', ')}${changed.length > 6 ? ` +${changed.length - 6}` : ''}`);

    // 5. checks, re-run by code (the agent's word is not the gate)
    if (checks.length && !opts.skipChecks) { rep.checks = runChecks(root, checks, cfg.checkTimeoutMs, baseline).map((c) => ({ id: c.id, command: c.command, passed: c.passed, preExisting: c.preExisting, newErrors: c.newErrors, ms: c.ms, tail: c.tail })); for (const c of rep.checks) log(`  ${c.passed ? '✓' : '✖'} ${c.command} (${(c.ms / 1000).toFixed(0)}s)${c.preExisting ? ' — fails as on the base branch, no new errors' : c.newErrors.length ? ` — ${c.newErrors.length} new error line(s)` : ''}`); }
    const green = rep.checks.every((c) => c.passed);

    // 6. commit (tracked + new files; never .fenceline runtime state)
    sh('git add -A', root);
    tryS('git reset -q -- .fenceline/state .fenceline/logs .fenceline/audit.log', root);
    const title = `${green ? '' : 'WIP: '}${text.length > 60 ? text.slice(0, 57) + '…' : text}`;
    const msg = `${title}\n\n${(rep.result.summary || '').trim()}\n\nAgent: ${runner.label}${opts.model ? ' / ' + opts.model : ''}; triage: ${rep.triage.verdict}; checks: ${rep.checks.length ? rep.checks.map((c) => `${c.id}=${c.preExisting ? 'pre-existing-failure' : c.passed ? 'pass' : 'FAIL'}`).join(', ') : 'none'}\nCo-Authored-By: fenceline task <noreply@fenceline.dev>`;
    fs.writeFileSync(path.join(root, '.fenceline', 'task-commit-msg.txt'), msg);
    sh('git commit -q -F .fenceline/task-commit-msg.txt', root);
    fs.unlinkSync(path.join(root, '.fenceline', 'task-commit-msg.txt'));
    rep.commit = tryS('git rev-parse --short HEAD', root);
    log(`  ✓ committed ${rep.commit} on ${branch}${green ? '' : ' (WIP — checks failing)'}`);

    // 7. draft PR when there is a remote and gh; otherwise leave the branch
    const remote = tryS('git remote get-url origin', root);
    const hasGh = !!tryS('gh --version', root);
    if (opts.pr !== false && remote && hasGh && runner.id !== 'fake') {
      try {
        sh(`git push -q -u origin ${branch}`, root);
        const body = prBody(rep);
        fs.writeFileSync(path.join(root, '.fenceline', 'task-pr-body.md'), body);
        const url = sh(`gh pr create --draft --base ${rep.base.replace(/^origin\//, '')} --head ${branch} --title ${JSON.stringify(title)} --body-file .fenceline/task-pr-body.md`, root);
        fs.unlinkSync(path.join(root, '.fenceline', 'task-pr-body.md'));
        rep.pr = url.split('\n').pop();
        log(`  ✓ draft PR: ${rep.pr}`);
      } catch (e) { rep.prError = String(e.message || e).slice(0, 300); log(`  · PR not opened: ${rep.prError.split('\n')[0]}`); }
    } else if (opts.pr !== false) log(`  · no draft PR: ${!remote ? 'no origin remote' : !hasGh ? 'gh not installed' : 'fake runner'} — branch ${branch} is committed locally`);
    rep.ok = green && !(rep.result.blockers || []).length;
  } finally {
    try { fs.unlinkSync(path.join(root, '.fenceline', 'state', 'baseline.json')); } catch { /* none */ }
    if (!opts.stay) restore();
    rep.finishedAt = new Date().toISOString();
    try { const dir = path.join(root, '.fenceline', 'tasks'); fs.mkdirSync(dir, { recursive: true }); rep.prBody = rep.result ? prBody(rep) : null; fs.writeFileSync(path.join(dir, `${slugify(text)}-${Date.now()}.json`), JSON.stringify(rep, null, 2)); } catch { /* best effort */ }
  }
  return rep;
}

module.exports = { run, slugify, hookStats, prBody, runChecks };

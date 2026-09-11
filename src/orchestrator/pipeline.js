'use strict';
// The fenceline pipeline: evidence → diagnose (agents) → compose (agent) → review (agent) → enforce → prove.
// Deterministic code collects facts and enforces; agents read the code and write everything that needs judgement.
const fs = require('fs');
const path = require('path');
const { getRunner } = require('./runners');
const evidenceMod = require('./evidence');
const R = require('../render');
const { globToRegex, slug } = require('./pipeline-utils');
const enforce = require('./enforce');
const verifyMod = require('./verify');

const PROMPTS = path.join(__dirname, 'prompts');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'schemas', 'diagnosis.json'), 'utf8'));
const prompt = (name, vars) => R.render(fs.readFileSync(path.join(PROMPTS, name), 'utf8'), vars);

const DEPTH = {
  quick: { areas: 0, maxTurns: 50, reviewTurns: 40, composeTurns: 60, budget: 8 },
  standard: { areas: 3, maxTurns: 60, reviewTurns: 50, composeTurns: 80, budget: 16 },
  deep: { areas: 6, maxTurns: 80, reviewTurns: 70, composeTurns: 100, budget: 30 },
};
// budget split per phase (fractions of the total). With fan-out the diagnosis share is spread over the agents.
const SPLIT_SINGLE = { diagnose: 0.45, compose: 0.30, review: 0.25 };
const SPLIT_FANOUT = { diagnose: 0.50, synthesize: 0.12, compose: 0.23, review: 0.15 };
// Project hooks (installed by enforce) must not interfere with the pipeline's own agents:
// the stop hook would demand a self-review from the compose agent and burn its budget.
const NO_HOOKS = { disableAllHooks: true };

// Rules are written once, in one neutral format, to docs/agent-rules/; enforce() converts them into each
// runtime's native format (.cursor/rules/*.mdc, .claude/rules/*.md with paths:, .github/instructions/*.instructions.md).
const RULE_FORMAT = `Write every rule file to \`docs/agent-rules/<name>.md\` with this frontmatter (it is converted to each runtime's native format afterwards):
\`\`\`
---
description: one line
globs: ["src/**/*.ts", "src/**/*.tsx"]   # omit for rules that always apply
alwaysApply: false                        # true for always-on rules
---
\`\`\`
Start CLAUDE.md with the line \`@AGENTS.md\` so Claude Code imports the operating manual.`;

// Areas for parallel diagnosis, by meaning rather than by size: fragile zones first (that is where the
// invariants are), then module boundaries (feature / module / package directories), ranked by churn and size.
// Small leftovers stay with the whole-repo agent. Returns at most n directories (with trailing slash).
const MODULE_ROOTS = /^(src\/(features|modules|domains|packages|apps|services|components|pages|app|lib|server|api|core)|packages|apps|services|internal|pkg|cmd|lib|app)\/[^/]+\/$/;
const NOISE = /^(node_modules|dist|build|out|docs|\.github|assets|public|vendor|coverage|test|tests|__tests__|e2e|scripts)\//;
function areasFrom(evidence, n, minFiles = 4) {
  if (!n) return [];
  const count = new Map();
  for (const line of evidence.files.tree) { const m = line.match(/^(.*) \((\d+) files\)$/); if (m) count.set(m[1], parseInt(m[2], 10)); }
  const churn = new Map();
  for (const l of evidence.git.churnTop) { const m = l.trim().match(/^(\d+)\s+(.+)$/); if (!m) continue; for (const [dir] of count) if (m[2].startsWith(dir)) churn.set(dir, (churn.get(dir) || 0) + parseInt(m[1], 10)); }
  const fragile = new Set(evidence.fragile.zones.map((z) => z.dir.replace(/\/$/, '') + '/'));
  const candidates = [...count.keys()].filter((d) => !NOISE.test(d) && count.get(d) >= minFiles && (fragile.has(d) || MODULE_ROOTS.test(d)));
  // prefer the deepest meaningful directory: drop a parent when a child candidate exists
  const leaves = candidates.filter((d) => !candidates.some((o) => o !== d && o.startsWith(d)));
  const score = (d) => (fragile.has(d) ? 1000 : 0) + (churn.get(d) || 0) * 3 + count.get(d);
  const chosen = leaves.sort((a, b) => score(b) - score(a)).slice(0, n);
  // if there are fewer meaningful leaves than slots, fall back to the largest second-level directories
  if (chosen.length < 2) {
    const big = [...count.keys()].filter((d) => !NOISE.test(d) && d.split('/').filter(Boolean).length === 2 && count.get(d) >= minFiles && !chosen.includes(d)).sort((a, b) => score(b) - score(a));
    for (const d of big) { if (chosen.length >= n) break; chosen.push(d); }
  }
  return chosen;
}

function fileSpec(diagnosis, targets, hasHooks) {
  const zones = diagnosis.fragileZones.map((z) => `- \`docs/${slug(z.dir)}.md\` — domain doc for \`${z.dir}\`: Code map (3–8 files, what each owns) · Do not break (the invariants, each with evidence) · Current facts (how it works today, numbers) · Known gaps (do not "fix" by accident).`);
  const rules = [
    '- `docs/agent-rules/fenceline-workflow.md` (alwaysApply: true): how an agent works here — scope, checks, self-review, "How to test", handoffs, when to stop.',
    '- `docs/agent-rules/fenceline-conventions.md` (globs: the main source globs): the conventions from the diagnosis with strength ≥ consistent, each with its evidence path; nothing generic.',
  ];
  return [
    '- `AGENTS.md` — operating manual for agents: one-line stack; task intake (what a task needs to be executable here); before-finishing checks (exact commands); Hard bans (enforced by hooks) — the protected paths, protected branches, sibling repos, secrets; human-only zones (convention); scope of an automatic PR; how to open a PR (branch prefix, base branch, draft, body with Summary + Test plan).' + (hasHooks ? ' State that hooks enforce the bans.' : ' State that nothing is enforced by hooks in this repository.'),
    '- `CLAUDE.md` — for humans writing tasks and for AI chats: what the project is (from the diagnosis, in its own words); stack; the vocabulary table (term · meaning · where in code · do not say); how to phrase a task here with a concrete example from this codebase; what breaks a PR here; fragile zones with links to the domain docs; verification commands.',
    '- `docs/agent-safe-tasks.md` — safe-list tuned to this repo: may be done autonomously / human-only, each item concrete to this codebase; the detected risk areas with evidence; the rule at the edge (in doubt → no PR, explain).',
    '- `docs/README.md` — index: the domain docs, handoffs, ADR, safe-list, one paragraph on how to use them.',
    ...zones, ...rules,
  ].join('\n');
}

// Run a phase that must end with structured output. If the agent hits its turn/budget cap before answering,
// resume the same session once and ask for the final answer from what it has already learned.
async function runStructured(runner, name, opts, log) {
  const r = await runner.run({ ...opts, phase: name });
  if (r.json || !r.sessionId || !r.limited) return r;
  log(`  · ${name}: cap reached after ${r.turns || '?'} turns without a final answer — asking for it from what was read`);
  const again = await runner.run({
    ...opts, phase: `${name}-finish`, resume: r.sessionId, maxTurns: 3, maxBudgetUsd: Math.max(0.75, Number(r.costUsd || 0) * 0.5), allowedTools: [], tools: '',
    prompt: 'You reached the tool-call cap. Do not read anything more. Produce the final structured answer NOW from what you have already learned. Anything you did not get to verify goes under openQuestions; do not invent evidence.',
  });
  return { ...again, costUsd: Number(r.costUsd || 0) + Number(again.costUsd || 0), turns: (r.turns || 0) + (again.turns || 0), recovered: !!again.json, limited: true };
}

async function runPhase(runner, name, opts, log) {
  log(`▸ ${name} …`);
  const started = Date.now();
  const r = await runner.run({ ...opts, phase: name });
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  if (!r.ok) log(`  ✖ ${name} failed after ${secs}s: ${r.authFail ? runner.authHint() : (r.text || r.stderr).slice(0, 400)}`);
  else log(`  ✓ ${name} done in ${secs}s${r.costUsd != null ? `, $${Number(r.costUsd).toFixed(2)}` : ''}${r.turns ? `, ${r.turns} turns` : ''}`);
  return r;
}

// opts: { runtime, targets[], depth, budgetUsd, model, effort, siblings, protectedBranches, log, components, skipReview, skipProve }
async function run(root, opts) {
  root = path.resolve(root);
  const log = opts.log || (() => {});
  const runner = getRunner(opts.runtime || 'claude');
  const det = runner.detect();
  if (!det.installed) throw new Error(`${runner.label} CLI not found on PATH (${runner.bin || runner.id}). Install it or pick another runtime.`);
  const depth = DEPTH[opts.depth || 'standard'];
  const budget = opts.budgetUsd || depth.budget;
  // Reading code does not need the strongest model; writing and criticising do.
  const models = { area: opts.areaModel || 'sonnet', whole: opts.areaModel || 'sonnet', synthesize: opts.areaModel || 'sonnet', compose: opts.model, review: opts.model };
  const auth = runner.authInfo ? runner.authInfo() : { billing: 'unknown', label: '' };
  if (auth.loggedIn === false) throw new Error(runner.authHint());
  log(`  auth: ${auth.label}`);
  const report = { root, runtime: runner.id, depth: opts.depth || 'standard', startedAt: new Date().toISOString(), phases: {}, costUsd: 0, billing: auth.billing, billingLabel: auth.label, models };
  const spent = (r) => { report.costUsd += Number(r.costUsd || 0); };

  // 0. evidence
  log('▸ evidence …');
  const evidence = evidenceMod.build(root);
  evidenceMod.write(root, evidence);
  const evidenceMd = evidenceMod.toMarkdown(evidence);
  log(`  ✓ evidence: ${evidence.files.count} files, ${evidence.risks.length} risk zones, ${evidence.fragile.zones.length} fragile zones, checks: ${[evidence.checks.lint, evidence.checks.typeCheck].filter(Boolean).join(' && ') || 'none'}`);
  report.phases.evidence = { files: evidence.files.count };

  // 1. diagnose (fan-out by area when depth allows)
  const areas = areasFrom(evidence, depth.areas);
  let diagnosis;
  const readOnly = runner.toolsReadOnly();
  if (areas.length >= 2) {
    const split = SPLIT_FANOUT;
    const perAgent = (budget * split.diagnose) / (areas.length + 1);
    log(`▸ diagnose: ${areas.length} area agents in parallel (${areas.join(', ')}) + whole-repo agent, ~$${perAgent.toFixed(2)} each, model ${models.area || 'default'}`);
    const jobs = [null, ...areas].map((area) => runStructured(runner, area ? `diagnose-${slug(area)}` : 'diagnose', {
      cwd: root, schema: SCHEMA, allowedTools: readOnly, permissionMode: 'dontAsk', maxTurns: depth.maxTurns, maxBudgetUsd: perAgent, model: area ? models.area : models.whole, effort: opts.effort, noPersist: false, settings: NO_HOOKS,
      prompt: prompt('diagnose.md', { evidence: area ? evidenceMod.toMarkdown(evidenceMod.focus(evidence, area)) : evidenceMd, turns: depth.maxTurns, scopeNote: area ? `Scope: concentrate on \`${area}\` — its architecture, entities, conventions, fragile zones and landmines. Other areas are context only. Fill project-level fields briefly.` : `Scope: the whole repository at the level of architecture, entry points, checks, protected paths, branches, siblings, safe tasks, and any code outside these areas, which other agents cover in depth: ${areas.join(', ')}. Do not read files inside those areas.` }),
    }, log));
    const results = await Promise.all(jobs);
    results.forEach((r, i) => { spent(r); log(`  ${r.json ? '✓' : '✖'} ${i === 0 ? 'whole-repo' : areas[i - 1]}: ${r.json ? 'diagnosis' : 'no output'}${r.recovered ? ' (recovered after cap)' : ''} — $${Number(r.costUsd || 0).toFixed(2)}, ${r.turns || '?'} turns`); });
    const partials = results.filter((r) => r.json).map((r) => r.json);
    if (!partials.length) { report.phases.diagnose = { ok: false }; throw new Error(results[0].authFail ? runner.authHint() : `diagnose produced no structured output from any agent (${results.map((r) => (r.text || r.stderr || '').slice(0, 120)).join(' | ')})`); }
    // deterministic merge first; the synthesizer only reconciles
    diagnosis = verifyMod.dedupe(mergeDiagnoses(partials, results[0].json ? 0 : -1)).diagnosis;
    const syn = await runStructured(runner, 'synthesize', { cwd: root, schema: SCHEMA, allowedTools: ['Read', 'Grep', 'Glob'], permissionMode: 'dontAsk', maxTurns: 12, maxBudgetUsd: budget * split.synthesize, model: models.synthesize, noPersist: false, settings: NO_HOOKS, prompt: prompt('synthesize.md', { merged: JSON.stringify(trimForSynthesis(diagnosis)), evidence: `(omitted — the merged diagnosis already carries the evidence; project name: ${evidence.stack.name}, stack: ${evidence.stack.summary.join(', ')})` }) }, log);
    spent(syn);
    if (syn.json) { diagnosis = syn.json; log(`  ✓ synthesize: reconciled — $${Number(syn.costUsd || 0).toFixed(2)}`); }
    else log('  · synthesize produced no output — using the deterministic merge of the area diagnoses');
    report.phases.diagnose = { ok: true, areas, partialsOk: partials.length, synthesized: !!syn.json };
  } else {
    const r = await runStructured(runner, 'diagnose', { cwd: root, schema: SCHEMA, allowedTools: readOnly, permissionMode: 'dontAsk', maxTurns: depth.maxTurns, maxBudgetUsd: budget * SPLIT_SINGLE.diagnose, model: models.whole, effort: opts.effort, noPersist: false, settings: NO_HOOKS, prompt: prompt('diagnose.md', { evidence: evidenceMd, turns: depth.maxTurns, scopeNote: 'Scope: the whole repository.' }) }, log);
    spent(r);
    log(`  ✓ diagnose: $${Number(r.costUsd || 0).toFixed(2)}, ${r.turns || '?'} turns${r.recovered ? ' (recovered after cap)' : ''}`);
    if (!r.ok || !r.json) throw new Error(r.authFail ? runner.authHint() : `diagnose produced no structured output: ${(r.text || '').slice(0, 300)}`);
    diagnosis = r.json;
    report.phases.diagnose = { ok: true, areas: [] };
  }
  fs.writeFileSync(path.join(root, '.fenceline', 'diagnosis.json'), JSON.stringify(diagnosis, null, 2));
  // deterministic clean-up before any file is written: cited paths / commits must exist; duplicates merge
  const v = verifyMod.verify(root, diagnosis); const dd = verifyMod.dedupe(v.diagnosis); diagnosis = dd.diagnosis;
  const dropped = v.report.demoted.length + v.report.dropped.length;
  if (dropped || v.report.flagged.length || Object.values(dd.report).some(Boolean)) log(`  ✓ verify: ${dropped} claims demoted/dropped (evidence not found), ${v.report.flagged.length} flagged; dedupe merged ${dd.report.conventions} conventions, ${dd.report.entities} entities, ${dd.report.landmines} landmines`);
  report.phases.verify = { ...v.report, merged: dd.report };
  diagnosis = normaliseZones(diagnosis);
  if (opts.diagnoseOnly) { report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(root, '.fenceline', `run-${report.startedAt.replace(/[:.]/g, '-')}.json`), JSON.stringify(report, null, 2)); return { report, diagnosis, evidence }; }
  log(`  ✓ diagnosis: ${diagnosis.entities.length} entities, ${diagnosis.conventions.length} conventions, ${diagnosis.fragileZones.length} fragile zones, ${diagnosis.protectedPaths.length} protected paths, ${diagnosis.landmines.length} landmines, ${diagnosis.openQuestions.length} open questions`);

  // 2. enforce — deterministic: hooks + config from the diagnosis (what the agent decided, how the code enforces)
  const targets = opts.targets && opts.targets.length ? opts.targets : ['claude'];
  const hasHooks = !opts.components || opts.components.includes('hooks');
  const enforced = enforce.apply(root, diagnosis, { targets, hasHooks, siblings: opts.siblings, protectedBranches: opts.protectedBranches, profile: opts.profile });
  report.phases.enforce = enforced.summary;
  log(`  ✓ enforce: ${enforced.summary.protectedPaths} protected path patterns, ${enforced.summary.checks} checks, hooks ${hasHooks ? 'wired for ' + targets.join(', ') : 'not installed'}${enforced.summary.commands ? `, ${enforced.summary.commands} slash commands` : ''}${enforced.summary.skippedGlobs.length ? ` (skipped globs: ${enforced.summary.skippedGlobs.join('; ')})` : ''}`);

  // 3. compose — the agent writes the environment
  const writable = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'docs/**'];
  const composeR = await runPhase(runner, 'compose', {
    cwd: root, allowedTools: runner.toolsWrite(writable), permissionMode: 'acceptEdits', maxTurns: depth.composeTurns, maxBudgetUsd: budget * (areas.length >= 2 ? SPLIT_FANOUT : SPLIT_SINGLE).compose, model: models.compose, noPersist: true, settings: NO_HOOKS,
    prompt: prompt('compose.md', { fileSpec: fileSpec(diagnosis, targets, hasHooks), ruleFormats: RULE_FORMAT, diagnosis: JSON.stringify(diagnosis, null, 1), evidence: evidenceMd }),
  }, log);
  spent(composeR);
  if (!composeR.ok) throw new Error(`compose failed: ${(composeR.text || '').slice(0, 300)}`);
  if (composeR.limited) log('  ! compose hit its budget/turn cap — files may be incomplete; raise --budget or use --depth quick on a smaller repo');
  const written = listWritten(root, writable).filter((f) => !/_TEMPLATE\.md$/.test(f));
  const docFindings = verifyMod.verifyDocs(root, written);
  if (docFindings.length) log(`  ! ${docFindings.length} files cite paths or commits that do not exist — handed to the critic`);
  const distributed = enforce.distributeRules(root, targets);
  if (distributed.length) log(`  ✓ rules: ${distributed.join(', ')}`);
  report.phases.compose = { ok: true, limited: !!composeR.limited, written, rules: distributed };
  log(`  ✓ compose: ${written.length} files — ${written.slice(0, 8).join(', ')}${written.length > 8 ? ', …' : ''}`);

  // 4. review — a fresh critic
  if (!opts.skipReview) {
    const reviewR = await runPhase(runner, 'review', {
      cwd: root, allowedTools: runner.toolsWrite(written), permissionMode: 'acceptEdits', maxTurns: depth.reviewTurns, maxBudgetUsd: budget * (areas.length >= 2 ? SPLIT_FANOUT : SPLIT_SINGLE).review, model: models.review, noPersist: true, settings: NO_HOOKS,
      prompt: prompt('review.md', { files: written.map((f) => `- ${f}`).join('\n'), diagnosis: JSON.stringify(diagnosis, null, 1), turns: depth.reviewTurns, prechecked: docFindings.length ? docFindings.map((f) => `- ${f.file}: ${[...f.missingPaths.map((p) => 'missing path `' + p + '`'), ...f.unknownCommits.map((c) => 'unknown commit `' + c + '`')].join(', ')}`).join('\n') : '- none: every cited path and commit exists' }),
    }, log);
    spent(reviewR);
    const rj = reviewR.json || extractJson(reviewR.text);
    report.phases.review = { ok: reviewR.ok, limited: !!reviewR.limited, summary: rj || (reviewR.text || '').slice(0, 800) };
    if (rj) log(`  ✓ review: ${rj.verdict || '?'} — ${(rj.findings || []).length} findings fixed${reviewR.limited ? ' (budget cap reached; partial)' : ''}`);
    else if (reviewR.limited) log('  ! review hit its budget/turn cap before reporting — edits it made are kept; raise --budget to let it finish');
    // rules may have been edited by the critic → re-distribute
    enforce.distributeRules(root, targets);
  }

  // 5. prove — doctor + canary through the real runtime
  if (!opts.skipProve && hasHooks) {
    const prove = require('./prove');
    const pr = await prove.run(root, runner, { targets, log, model: opts.model });
    spent(pr);
    report.phases.prove = pr.summary;
  }

  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(root, '.fenceline', `run-${report.startedAt.replace(/[:.]/g, '-')}.json`), JSON.stringify(report, null, 2));
  return { report, diagnosis, evidence };
}

// Union of partial diagnoses. Project-level fields come from the whole-repo agent (index `primary`) when it
// answered, else from the first partial; list fields are concatenated and de-duplicated by their natural key.
function mergeDiagnoses(partials, primary) {
  const base = partials[primary >= 0 ? primary : 0];
  const uniq = (key) => { const seen = new Set(); return partials.flatMap((p) => _uniqPath(p, key)).filter((x) => { const k = JSON.stringify(x.term || x.rule || x.dir || x.glob || x.id || x.what || x.command || x).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };
  const strs = (key) => [...new Set(partials.flatMap((p) => p[key] || []))];
  return {
    project: base.project, architecture: { ...base.architecture, layers: uniq('architecture.layers') },
    entities: uniq('entities'), conventions: uniq('conventions'), checks: uniq('checks'), fragileZones: uniq('fragileZones'), riskAreas: uniq('riskAreas'),
    protectedPaths: uniq('protectedPaths'), protectedBranches: strs('protectedBranches'), siblingRepos: strs('siblingRepos'),
    safeTasks: { auto: [...new Set(partials.flatMap((p) => (p.safeTasks || {}).auto || []))], human: [...new Set(partials.flatMap((p) => (p.safeTasks || {}).human || []))] },
    landmines: uniq('landmines'), undocumented: strs('undocumented'), openQuestions: strs('openQuestions'),
  };
}
// nested key support for uniq('architecture.layers')
const _uniqPath = (p, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), p) || [];

// Fragile zones must be directories, unique, and few: a domain doc per zone is only worth it for the worst ones.
function normaliseZones(diagnosis, max = 6) {
  const byDir = new Map();
  for (const z of diagnosis.fragileZones || []) {
    let dir = String(z.dir || '').trim().replace(/\s*\(.*$/, '').replace(/,.*$/, '').replace(/\/+$/, '');
    if (/\.[a-z]{1,5}$/i.test(dir) && dir.includes('/')) dir = dir.replace(/\/[^/]+$/, ''); // a file → its directory
    if (!dir) continue;
    const cur = byDir.get(dir);
    if (!cur) byDir.set(dir, { ...z, dir });
    else { cur.invariants = [...(cur.invariants || []), ...(z.invariants || [])]; cur.knownGaps = [...new Set([...(cur.knownGaps || []), ...(z.knownGaps || [])])]; cur.recentFixes = [...new Set([...(cur.recentFixes || []), ...(z.recentFixes || [])])]; cur.why = cur.why.length >= (z.why || '').length ? cur.why : z.why; }
  }
  diagnosis.fragileZones = [...byDir.values()].sort((a, b) => (b.invariants || []).length + (b.recentFixes || []).length - (a.invariants || []).length - (a.recentFixes || []).length).slice(0, max);
  return diagnosis;
}

// Trim a merged diagnosis to what a reconcile pass needs to see (long lists are the whole reason it is expensive).
function trimForSynthesis(d, caps = { entities: 30, conventions: 30, landmines: 25, openQuestions: 25, undocumented: 15 }) {
  const out = { ...d };
  for (const [k, n] of Object.entries(caps)) if (Array.isArray(out[k]) && out[k].length > n) out[k] = out[k].slice(0, n);
  return out;
}

function extractJson(s) {
  const m = String(s || '').match(/```json\s*([\s\S]*?)```/) || String(s || '').match(/(\{[\s\S]*\})\s*$/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function listWritten(root, globs) {
  // files under the writable set that changed in the last run: use mtime within the last hour as a cheap proxy when git is absent
  const out = [];
  const since = Date.now() - 2 * 3600 * 1000;
  const visit = (dir, rel) => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (['node_modules', '.git', '.fenceline'].includes(e.name)) continue; visit(path.join(dir, e.name), r); continue; }
      if (!/\.(md|mdc)$/.test(e.name)) continue;
      if (!globs.some((g) => new RegExp(globToRegex(g)).test(r))) continue;
      try { if (fs.statSync(path.join(dir, e.name)).mtimeMs >= since) out.push(r); } catch { /* ignore */ }
    }
  };
  visit(root, '');
  return out.sort();
}

// "$3.58" means different things depending on how the runtime is paid for.
function costLine(report) {
  const usd = `$${Number(report.costUsd || 0).toFixed(2)}`;
  if (report.billing === 'subscription') return `≈ ${usd} API-equivalent (${report.billingLabel.split(' — ')[0]}; counts against usage limits, not billed)`;
  if (report.billing === 'api') return `${usd} billed to your API key`;
  return `${usd} (API-equivalent estimate reported by the runtime)`;
}

module.exports = { run, DEPTH, areasFrom, fileSpec, costLine };

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

const PROMPTS = path.join(__dirname, 'prompts');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'schemas', 'diagnosis.json'), 'utf8'));
const prompt = (name, vars) => R.render(fs.readFileSync(path.join(PROMPTS, name), 'utf8'), vars);

const DEPTH = {
  quick: { areas: 0, maxTurns: 50, reviewTurns: 40, composeTurns: 60, budget: 6 },
  standard: { areas: 3, maxTurns: 70, reviewTurns: 50, composeTurns: 80, budget: 12 },
  deep: { areas: 6, maxTurns: 100, reviewTurns: 70, composeTurns: 100, budget: 25 },
};
// budget split per phase (fractions of the total); synthesis only exists with fan-out
const SPLIT = { diagnose: 0.40, synthesize: 0.10, compose: 0.30, review: 0.20 };
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

function areasFrom(evidence, n) {
  if (!n) return [];
  const dirs = new Map();
  for (const line of evidence.files.tree) {
    const m = line.match(/^([^/]+\/[^/]+\/)? ?(.*)\((\d+) files\)$/);
    const [dir, count] = [line.split(' (')[0], parseInt(line.match(/\((\d+) files\)/)[1], 10)];
    if (dir.split('/').filter(Boolean).length === 2 && count >= 5) dirs.set(dir, count);
  }
  const ranked = [...dirs.entries()].filter(([d]) => !/^(node_modules|dist|build|docs|\.github|assets|public|vendor|coverage)\//.test(d)).sort((a, b) => b[1] - a[1]);
  const fragile = new Set(evidence.fragile.zones.map((z) => z.dir + '/'));
  const chosen = [...ranked.filter(([d]) => fragile.has(d)), ...ranked.filter(([d]) => !fragile.has(d))].slice(0, n).map(([d]) => d);
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
  const report = { root, runtime: runner.id, depth: opts.depth || 'standard', startedAt: new Date().toISOString(), phases: {}, costUsd: 0 };
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
    log(`▸ diagnose: ${areas.length} area agents in parallel (${areas.join(', ')}) + whole-repo agent`);
    const jobs = [null, ...areas].map((area) => runner.run({
      phase: area ? `diagnose-${slug(area)}` : 'diagnose',
      cwd: root, schema: SCHEMA, allowedTools: readOnly, permissionMode: 'dontAsk', maxTurns: depth.maxTurns, maxBudgetUsd: (budget * SPLIT.diagnose) / (areas.length + 1), model: opts.model, effort: opts.effort, noPersist: true, settings: NO_HOOKS,
      prompt: prompt('diagnose.md', { evidence: evidenceMd, scopeNote: area ? `Scope: concentrate on \`${area}\` — its architecture, entities, conventions, fragile zones and landmines. Other areas are context only. Still fill project-level fields briefly.` : 'Scope: the whole repository at the level of architecture, entry points, checks, protected paths, branches, siblings and safe tasks. Other agents cover individual areas in depth.' }),
    }));
    const results = await Promise.all(jobs);
    results.forEach((r) => spent(r));
    const failed = results.filter((r) => !r.ok);
    if (failed.length === results.length) { report.phases.diagnose = { ok: false, error: failed[0].text }; throw new Error(failed[0].authFail ? runner.authHint() : `diagnose failed: ${failed[0].text.slice(0, 300)}`); }
    const partials = results.filter((r) => r.ok && r.json).map((r, i) => `### Partial ${i + 1}\n\n\`\`\`json\n${JSON.stringify(r.json, null, 1)}\n\`\`\``).join('\n\n');
    const syn = await runPhase(runner, 'synthesize', { cwd: root, schema: SCHEMA, allowedTools: readOnly, permissionMode: 'dontAsk', maxTurns: 30, maxBudgetUsd: budget * SPLIT.synthesize, model: opts.model, noPersist: true, settings: NO_HOOKS, prompt: prompt('synthesize.md', { partials, evidence: evidenceMd }) }, log);
    spent(syn);
    if (!syn.ok || !syn.json) throw new Error(`synthesize failed: ${(syn.text || '').slice(0, 300)}`);
    diagnosis = syn.json;
    report.phases.diagnose = { ok: true, areas, partialsOk: results.filter((r) => r.ok).length };
  } else {
    const r = await runPhase(runner, 'diagnose', { cwd: root, schema: SCHEMA, allowedTools: readOnly, permissionMode: 'dontAsk', maxTurns: depth.maxTurns, maxBudgetUsd: budget * (SPLIT.diagnose + SPLIT.synthesize), model: opts.model, effort: opts.effort, noPersist: true, settings: NO_HOOKS, prompt: prompt('diagnose.md', { evidence: evidenceMd, scopeNote: 'Scope: the whole repository.' }) }, log);
    spent(r);
    if (!r.ok || !r.json) throw new Error(r.authFail ? runner.authHint() : `diagnose produced no structured output: ${(r.text || '').slice(0, 300)}`);
    diagnosis = r.json;
    report.phases.diagnose = { ok: true, areas: [] };
  }
  fs.writeFileSync(path.join(root, '.fenceline', 'diagnosis.json'), JSON.stringify(diagnosis, null, 2));
  if (opts.diagnoseOnly) { report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(root, '.fenceline', `run-${report.startedAt.replace(/[:.]/g, '-')}.json`), JSON.stringify(report, null, 2)); return { report, diagnosis, evidence }; }
  log(`  ✓ diagnosis: ${diagnosis.entities.length} entities, ${diagnosis.conventions.length} conventions, ${diagnosis.fragileZones.length} fragile zones, ${diagnosis.protectedPaths.length} protected paths, ${diagnosis.landmines.length} landmines, ${diagnosis.openQuestions.length} open questions`);

  // 2. enforce — deterministic: hooks + config from the diagnosis (what the agent decided, how the code enforces)
  const targets = opts.targets && opts.targets.length ? opts.targets : ['claude'];
  const hasHooks = !opts.components || opts.components.includes('hooks');
  const enforced = enforce.apply(root, diagnosis, { targets, hasHooks, siblings: opts.siblings, protectedBranches: opts.protectedBranches, profile: opts.profile });
  report.phases.enforce = enforced.summary;
  log(`  ✓ enforce: ${enforced.summary.protectedPaths} protected path patterns, ${enforced.summary.checks} checks, hooks ${hasHooks ? 'wired for ' + targets.join(', ') : 'not installed'}`);

  // 3. compose — the agent writes the environment
  const writable = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'docs/**'];
  const composeR = await runPhase(runner, 'compose', {
    cwd: root, allowedTools: runner.toolsWrite(writable), permissionMode: 'acceptEdits', maxTurns: depth.composeTurns, maxBudgetUsd: budget * SPLIT.compose, model: opts.model, noPersist: true, settings: NO_HOOKS,
    prompt: prompt('compose.md', { fileSpec: fileSpec(diagnosis, targets, hasHooks), ruleFormats: RULE_FORMAT, diagnosis: JSON.stringify(diagnosis, null, 1), evidence: evidenceMd }),
  }, log);
  spent(composeR);
  if (!composeR.ok) throw new Error(`compose failed: ${(composeR.text || '').slice(0, 300)}`);
  if (composeR.limited) log('  ! compose hit its budget/turn cap — files may be incomplete; raise --budget or use --depth quick on a smaller repo');
  const written = listWritten(root, writable).filter((f) => !/_TEMPLATE\.md$/.test(f));
  const distributed = enforce.distributeRules(root, targets);
  if (distributed.length) log(`  ✓ rules: ${distributed.join(', ')}`);
  report.phases.compose = { ok: true, limited: !!composeR.limited, written, rules: distributed };
  log(`  ✓ compose: ${written.length} files — ${written.slice(0, 8).join(', ')}${written.length > 8 ? ', …' : ''}`);

  // 4. review — a fresh critic
  if (!opts.skipReview) {
    const reviewR = await runPhase(runner, 'review', {
      cwd: root, allowedTools: runner.toolsWrite(written), permissionMode: 'acceptEdits', maxTurns: depth.reviewTurns, maxBudgetUsd: budget * SPLIT.review, model: opts.model, noPersist: true, settings: NO_HOOKS,
      prompt: prompt('review.md', { files: written.map((f) => `- ${f}`).join('\n'), diagnosis: JSON.stringify(diagnosis, null, 1) }),
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

module.exports = { run, DEPTH, areasFrom, fileSpec };

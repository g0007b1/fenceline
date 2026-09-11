'use strict';
// Evidence pack: the facts an agent would otherwise spend twenty tool calls collecting.
// Deterministic, seconds, no API. Written to .fenceline/evidence.json and rendered as markdown for prompts.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { scan, walkFiles } = require('../scan');

function sh(cmd, cwd, max = 4 * 1024 * 1024) { try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: max, timeout: 20000 }); } catch { return ''; }
}

function tree(files, maxDepth = 3, maxEntries = 400) {
  const counts = new Map();
  for (const f of files) {
    const parts = f.split('/');
    for (let d = 1; d <= Math.min(maxDepth, parts.length - 1); d++) {
      const key = parts.slice(0, d).join('/') + '/';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, maxEntries).map(([dir, n]) => `${dir} (${n} files)`);
}

function readCapped(root, rel, cap = 6000) {
  try { const s = fs.readFileSync(path.join(root, rel), 'utf8'); return s.length > cap ? s.slice(0, cap) + `\n…(truncated, ${s.length} chars total)` : s; } catch { return null; }
}

function build(root) {
  root = path.resolve(root);
  const profile = scan(root);
  const files = walkFiles(root);
  const byExt = {};
  for (const f of files) { const e = path.extname(f) || '(none)'; byExt[e] = (byExt[e] || 0) + 1; }
  const topExt = Object.entries(byExt).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const gitLog = sh('git log --since="18 months ago" --pretty=format:"%h %ad %an: %s" --date=short -n 120', root).trim();
  const authors = sh('git shortlog -sn --since="18 months ago" HEAD', root).trim().split('\n').filter(Boolean).slice(0, 10);
  const churn = sh('git log --since="18 months ago" --name-only --pretty=format: | sort | uniq -c | sort -rn | head -40', root).trim();
  const existingDocs = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'GEMINI.md', '.cursorrules', 'docs/README.md', 'ARCHITECTURE.md', 'CONTEXT-MAP.md']
    .filter((f) => fs.existsSync(path.join(root, f))).map((f) => ({ file: f, content: readCapped(root, f, 5000) }));
  const rulesDirs = ['.cursor/rules', '.claude/rules', '.github/instructions', 'docs/agent-rules'].filter((d) => fs.existsSync(path.join(root, d)))
    .map((d) => ({ dir: d, files: fs.readdirSync(path.join(root, d)).slice(0, 20) }));
  const manifests = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'Makefile', 'justfile', 'docker-compose.yml', '.env.example', 'tsconfig.json']
    .filter((f) => fs.existsSync(path.join(root, f))).map((f) => ({ file: f, content: readCapped(root, f, 3000) }));
  const testFiles = profile.tests.sample;
  const ci = fs.existsSync(path.join(root, '.github/workflows')) ? fs.readdirSync(path.join(root, '.github/workflows')).map((f) => ({ file: `.github/workflows/${f}`, content: readCapped(root, `.github/workflows/${f}`, 2500) })) : [];
  const evidence = {
    version: 1, generatedAt: new Date().toISOString(), root,
    stack: profile.stack, preset: profile.preset, checks: profile.stack.checks, warnings: profile.warnings,
    risks: profile.risks, fragile: profile.fragile, siblings: profile.siblings, tests: profile.tests,
    files: { count: files.length, byExtension: topExt, tree: tree(files) },
    git: { available: !!gitLog, recentCommits: gitLog.split('\n').slice(0, 120), authors, churnTop: churn.split('\n').slice(0, 40) },
    existingDocs, rulesDirs, manifests, ci, testFiles,
  };
  return evidence;
}

function toMarkdown(e) {
  const L = [];
  L.push(`# Evidence pack for ${e.stack.name}`, '', `Generated ${e.generatedAt}. Facts collected deterministically; verify anything surprising in the code.`, '');
  L.push('## Stack (detected)', '', `- Summary: ${e.stack.summary.join(', ')}`, `- Ecosystems: ${(e.stack.ecosystems || []).join(', ')}`, `- Preset guess: ${e.preset}`,
    `- Checks found: lint=${e.checks.lint || '—'} | types=${e.checks.typeCheck || '—'} | test=${e.checks.test || '—'} | build=${e.checks.build || '—'}`,
    `- Tests found: ${e.tests.count} (e.g. ${e.tests.sample.join(', ') || 'none'})`, `- Files: ${e.files.count}; by extension: ${e.files.byExtension.map(([x, n]) => `${x}:${n}`).join(', ')}`);
  if (e.warnings.length) L.push('', '## Scanner warnings', '', ...e.warnings.map((w) => `- ${w}`));
  L.push('', '## Directory tree (depth 3, file counts)', '', '```', ...e.files.tree, '```');
  L.push('', '## Risk zones (from dependencies and path names)', '', ...(e.risks.length ? e.risks.map((r) => `- ${r.label}: ${[...r.deps, ...r.paths.slice(0, 5)].join(', ')}`) : ['- none detected']));
  L.push('', '## High-churn areas (git, 18 months)', '', ...(e.fragile.zones.length ? e.fragile.zones.map((z) => `- ${z.dir}: ${z.commits} commits, ${z.fixes} bug-fix commits, ${z.authors} authors`) : ['- none above threshold / no git history']));
  if (e.git.churnTop.length) L.push('', '### Most-changed files', '', '```', ...e.git.churnTop, '```');
  if (e.git.recentCommits.length) L.push('', '### Recent commits (up to 120)', '', '```', ...e.git.recentCommits, '```');
  if (e.git.authors.length) L.push('', `### Authors: ${e.git.authors.map((a) => a.trim()).join('; ')}`);
  if (e.siblings.length) L.push('', `## Neighbouring repositories (candidates for read-only siblings): ${e.siblings.join(', ')}`);
  for (const m of e.manifests) L.push('', `## ${m.file}`, '', '```', m.content || '', '```');
  for (const d of e.existingDocs) L.push('', `## Existing doc: ${d.file}`, '', '```markdown', d.content || '', '```');
  if (e.rulesDirs.length) L.push('', '## Existing agent rules', '', ...e.rulesDirs.map((r) => `- ${r.dir}: ${r.files.join(', ')}`));
  for (const c of e.ci) L.push('', `## CI: ${c.file}`, '', '```yaml', c.content || '', '```');
  return L.join('\n');
}

function write(root, evidence) {
  const dir = path.join(root, '.fenceline');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  fs.writeFileSync(path.join(dir, 'evidence.md'), toMarkdown(evidence));
  return { json: '.fenceline/evidence.json', md: '.fenceline/evidence.md' };
}

module.exports = { build, toMarkdown, write };

'use strict';
// GitHub Copilot (coding agent + CLI) adapter: .github/hooks/fenceline.json per
// https://docs.github.com/en/copilot/reference/hooks-reference — {version:1, hooks:{preToolUse:[{type:"command", bash, powershell}]}},
// stdin {toolName, toolArgs, cwd}, stdout {"permissionDecision":"allow|deny|ask"}. Rules go to
// .github/instructions/*.instructions.md (applyTo frontmatter); AGENTS.md is read natively.
// Status: wired from the published docs, not yet verified against a live session → experimental.
const fs = require('fs');
const path = require('path');

function cmd(script) {
  return { type: 'command', bash: `node .fenceline/hooks/${script} --runtime copilot`, powershell: `node .fenceline/hooks/${script} --runtime copilot`, timeoutSec: 60 };
}

function writeHooksConfig(root, cfg) {
  const file = path.join(root, '.github', 'hooks', 'fenceline.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const stopTimeout = Math.ceil((cfg.checkTimeoutMs || 180000) / 1000) * (cfg.checks || []).length + 30;
  const out = {
    version: 1,
    hooks: {
      sessionStart: [cmd('session-start.js')],
      preToolUse: [cmd('guard-write.js'), cmd('guard-read.js'), cmd('guard-shell.js')],
      postToolUse: [cmd('track-edit.js'), cmd('track-checks.js')],
      agentStop: [{ ...cmd('ensure-checks.js'), timeoutSec: stopTimeout }],
    },
  };
  const status = fs.existsSync(file) ? 'updated' : 'created';
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  return { file: '.github/hooks/fenceline.json', status };
}

function removeHooksConfig(root) {
  const file = path.join(root, '.github', 'hooks', 'fenceline.json');
  if (!fs.existsSync(file)) return null;
  fs.unlinkSync(file);
  try { if (!fs.readdirSync(path.dirname(file)).length) fs.rmdirSync(path.dirname(file)); } catch { /* keep */ }
  return { file: '.github/hooks/fenceline.json', status: 'removed' };
}

function isWired(root) { return fs.existsSync(path.join(root, '.github', 'hooks', 'fenceline.json')); }

// .mdc frontmatter → Copilot instructions frontmatter (applyTo).
function convertRule(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return content;
  const body = content.slice(m[0].length);
  const description = (m[1].match(/^description:\s*(.+)$/m) || [])[1];
  const globsRaw = (m[1].match(/^globs:\s*(.+)$/m) || [])[1];
  const globs = globsRaw ? (globsRaw.trim().startsWith('[') ? globsRaw.trim().slice(1, -1).split(',') : [globsRaw]).map((g) => g.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [];
  const always = /^alwaysApply:\s*true/m.test(m[1]);
  const fm = ['---', `applyTo: "${always || !globs.length ? '**' : globs.join(',')}"`];
  if (description) fm.push(`description: ${description}`);
  fm.push('---');
  return fm.join('\n') + '\n' + body;
}

module.exports = { id: 'copilot', hooksFile: '.github/hooks/fenceline.json', label: 'GitHub Copilot', enforces: true, experimental: true, rulesPath: '.github/instructions', ruleExt: '.instructions.md', commandsPath: null, writeHooksConfig, removeHooksConfig, isWired, convertRule };

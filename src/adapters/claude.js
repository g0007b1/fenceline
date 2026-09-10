'use strict';
// Claude Code adapter: hooks in .claude/settings.json (enforced), path-scoped rules in .claude/rules/*.md,
// slash commands in .claude/commands/*.md. CLAUDE.md is read natively and imports AGENTS.md.
// Verified against https://code.claude.com/docs/en/hooks (Sept 2026): SessionStart matcher = source
// (startup|resume|clear|compact), PreToolUse permissionDecision allow|deny|ask, Stop {decision:"block"},
// built-in tools Bash | PowerShell | Edit | Write | NotebookEdit | Read (MultiEdit no longer exists).
const fs = require('fs');
const path = require('path');

const OURS = '.fenceline/hooks/';
function hookCmd(script) { return `node "$CLAUDE_PROJECT_DIR/.fenceline/hooks/${script}" --runtime claude`; }
function entry(matcher, script, extra) {
  const e = { hooks: [{ type: 'command', command: hookCmd(script), ...(extra || {}) }] };
  if (matcher) e.matcher = matcher;
  return e;
}

function ourHooks(cfg) {
  const stopTimeout = Math.ceil((cfg.checkTimeoutMs || 180000) / 1000) * (cfg.checks || []).length + 30;
  return {
    SessionStart: [entry('startup|clear|resume|compact', 'session-start.js')],
    PreToolUse: [entry('Write|Edit|NotebookEdit', 'guard-write.js'), entry('Read', 'guard-read.js'), entry('Bash|PowerShell', 'guard-shell.js')],
    PostToolUse: [entry('Write|Edit|NotebookEdit', 'track-edit.js'), entry('Bash|PowerShell', 'track-checks.js')],
    Stop: [entry(null, 'ensure-checks.js', { timeout: stopTimeout })],
  };
}

function writeHooksConfig(root, cfg) {
  const file = path.join(root, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let settings = {};
  let status = 'created';
  if (fs.existsSync(file)) {
    try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); status = 'updated'; }
    catch (e) { throw new Error(`${file} is not valid JSON (${e.message}). Fix or remove it, then re-run — fenceline never overwrites a settings file it cannot parse.`); }
  }
  settings.hooks = settings.hooks || {};
  for (const [event, list] of Object.entries(ourHooks(cfg))) {
    const foreign = (settings.hooks[event] || []).filter((e) => !JSON.stringify(e).includes(OURS));
    settings.hooks[event] = [...foreign, ...list];
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { file: '.claude/settings.json', status };
}

function removeHooksConfig(root) {
  const file = path.join(root, '.claude', 'settings.json');
  if (!fs.existsSync(file)) return null;
  try {
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [event, list] of Object.entries(settings.hooks || {})) {
      const foreign = list.filter((e) => !JSON.stringify(e).includes(OURS));
      if (foreign.length) settings.hooks[event] = foreign; else delete settings.hooks[event];
    }
    if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
    if (!Object.keys(settings).length) { fs.unlinkSync(file); return { file: '.claude/settings.json', status: 'removed' }; }
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
    return { file: '.claude/settings.json', status: 'cleaned' };
  } catch { return null; }
}

function isWired(root) {
  const file = path.join(root, '.claude', 'settings.json');
  return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(OURS);
}

// .mdc frontmatter (description / globs / alwaysApply) → Claude rules frontmatter (description / paths).
function convertRule(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return content;
  const body = content.slice(m[0].length);
  const description = (m[1].match(/^description:\s*(.+)$/m) || [])[1];
  const globsRaw = (m[1].match(/^globs:\s*(.+)$/m) || [])[1];
  const globs = globsRaw ? (globsRaw.trim().startsWith('[') ? globsRaw.trim().slice(1, -1).split(',') : [globsRaw]).map((g) => g.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [];
  const always = /^alwaysApply:\s*true/m.test(m[1]);
  const fm = ['---'];
  if (description) fm.push(`description: ${description}`);
  if (globs.length && !always) fm.push('paths:', ...globs.map((g) => `  - "${g}"`));
  fm.push('---');
  return fm.join('\n') + '\n' + body;
}

module.exports = { id: 'claude', hooksFile: '.claude/settings.json', label: 'Claude Code', enforces: true, experimental: false, rulesPath: '.claude/rules', ruleExt: '.md', commandsPath: '.claude/commands', writeHooksConfig, removeHooksConfig, isWired, convertRule };

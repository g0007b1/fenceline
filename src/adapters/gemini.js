'use strict';
// Gemini CLI adapter: hooks in .gemini/settings.json (https://geminicli.com/docs/hooks/), rules as markdown
// linked from GEMINI.md / AGENTS.md. Tools: write_file, replace (edits), read_file, run_shell_command.
// Output shape: {"decision":"deny","reason"}; exit 2 blocks. No documented "ask" → we deny with a reason.
// Status: wired from the published docs, not yet verified against a live session → experimental.
const fs = require('fs');
const path = require('path');

const OURS = '.agent-ready/hooks/';
function hookCmd(script) { return `node .agent-ready/hooks/${script} --runtime gemini`; }
function entry(matcher, script, extra) {
  const e = { hooks: [{ type: 'command', command: hookCmd(script), ...(extra || {}) }] };
  if (matcher) e.matcher = matcher;
  return e;
}

function ourHooks(cfg) {
  const stopTimeout = Math.ceil((cfg.checkTimeoutMs || 180000) / 1000) * (cfg.checks || []).length + 30;
  return {
    SessionStart: [entry(null, 'session-start.js')],
    BeforeTool: [entry('write_file|replace|edit', 'guard-write.js'), entry('read_file', 'guard-read.js'), entry('run_shell_command', 'guard-shell.js')],
    AfterTool: [entry('write_file|replace|edit', 'track-edit.js'), entry('run_shell_command', 'track-checks.js')],
    AfterAgent: [entry(null, 'ensure-checks.js', { timeout: stopTimeout })],
  };
}

function writeHooksConfig(root, cfg) {
  const file = path.join(root, '.gemini', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let settings = {};
  let status = 'created';
  if (fs.existsSync(file)) {
    try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); status = 'updated'; }
    catch (e) { throw new Error(`${file} is not valid JSON (${e.message}). Fix or remove it, then re-run.`); }
  }
  settings.hooks = settings.hooks || {};
  for (const [event, list] of Object.entries(ourHooks(cfg))) {
    const foreign = (settings.hooks[event] || []).filter((e) => !JSON.stringify(e).includes(OURS));
    settings.hooks[event] = [...foreign, ...list];
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { file: '.gemini/settings.json', status };
}

function removeHooksConfig(root) {
  const file = path.join(root, '.gemini', 'settings.json');
  if (!fs.existsSync(file)) return null;
  try {
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [event, list] of Object.entries(settings.hooks || {})) {
      const foreign = list.filter((e) => !JSON.stringify(e).includes(OURS));
      if (foreign.length) settings.hooks[event] = foreign; else delete settings.hooks[event];
    }
    if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
    if (!Object.keys(settings).length) { fs.unlinkSync(file); return { file: '.gemini/settings.json', status: 'removed' }; }
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
    return { file: '.gemini/settings.json', status: 'cleaned' };
  } catch { return null; }
}

function isWired(root) {
  const file = path.join(root, '.gemini', 'settings.json');
  return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(OURS);
}

function convertRule(content) { return content.replace(/^---\n[\s\S]*?\n---\n/, ''); }

module.exports = { id: 'gemini', hooksFile: '.gemini/settings.json', label: 'Gemini CLI', enforces: true, experimental: true, rulesPath: 'docs/agent-rules', ruleExt: '.md', commandsPath: null, writeHooksConfig, removeHooksConfig, isWired, convertRule };

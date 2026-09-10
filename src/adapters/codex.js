'use strict';
// Codex CLI adapter: hooks in .codex/hooks.json (Claude-style JSON, per https://developers.openai.com/codex/hooks),
// rules as plain markdown linked from AGENTS.md (Codex reads AGENTS.md natively).
// Notes from the docs: file edits arrive as tool `apply_patch` with the patch text in tool_input.command
// (guard-write parses `*** Update File:` lines); there is no CLAUDE_PROJECT_DIR — the hook locates the
// repo by walking up from cwd; Codex asks the user to trust project hooks once via /hooks.
// Status: wired from the published docs, not yet verified against a live Codex session → experimental.
const fs = require('fs');
const path = require('path');

const OURS = '.fenceline/hooks/';
function hookCmd(script) { return `node .fenceline/hooks/${script} --runtime codex`; }
function entry(matcher, script, extra) {
  const e = { hooks: [{ type: 'command', command: hookCmd(script), ...(extra || {}) }] };
  if (matcher) e.matcher = matcher;
  return e;
}

function ourHooks(cfg) {
  const stopTimeout = Math.ceil((cfg.checkTimeoutMs || 180000) / 1000) * (cfg.checks || []).length + 30;
  return {
    SessionStart: [entry(null, 'session-start.js')],
    PreToolUse: [entry('apply_patch|Edit|Write', 'guard-write.js'), entry('Read|read_file', 'guard-read.js'), entry('Bash|shell|local_shell|exec_command', 'guard-shell.js')],
    PostToolUse: [entry('apply_patch|Edit|Write', 'track-edit.js'), entry('Bash|shell|local_shell|exec_command', 'track-checks.js')],
    Stop: [entry(null, 'ensure-checks.js', { timeout: stopTimeout })],
  };
}

function writeHooksConfig(root, cfg) {
  const file = path.join(root, '.codex', 'hooks.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let existing = {};
  let status = 'created';
  if (fs.existsSync(file)) {
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); status = 'updated'; }
    catch (e) { throw new Error(`${file} is not valid JSON (${e.message}). Fix or remove it, then re-run.`); }
  }
  // Codex accepts either a bare event map or { hooks: {...} }; we keep whichever shape exists.
  const container = existing.hooks && typeof existing.hooks === 'object' ? existing.hooks : existing;
  for (const [event, list] of Object.entries(ourHooks(cfg))) {
    const foreign = (container[event] || []).filter((e) => !JSON.stringify(e).includes(OURS));
    container[event] = [...foreign, ...list];
  }
  fs.writeFileSync(file, JSON.stringify(existing, null, 2) + '\n');
  return { file: '.codex/hooks.json', status };
}

function removeHooksConfig(root) {
  const file = path.join(root, '.codex', 'hooks.json');
  if (!fs.existsSync(file)) return null;
  try {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    const container = existing.hooks && typeof existing.hooks === 'object' ? existing.hooks : existing;
    for (const [event, list] of Object.entries(container)) {
      if (!Array.isArray(list)) continue;
      const foreign = list.filter((e) => !JSON.stringify(e).includes(OURS));
      if (foreign.length) container[event] = foreign; else delete container[event];
    }
    const empty = !Object.keys(container).length;
    if (empty) { fs.unlinkSync(file); return { file: '.codex/hooks.json', status: 'removed' }; }
    fs.writeFileSync(file, JSON.stringify(existing, null, 2) + '\n');
    return { file: '.codex/hooks.json', status: 'cleaned' };
  } catch { return null; }
}

function isWired(root) {
  const file = path.join(root, '.codex', 'hooks.json');
  return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(OURS);
}

function convertRule(content) { return content.replace(/^---\n[\s\S]*?\n---\n/, ''); }

module.exports = { id: 'codex', hooksFile: '.codex/hooks.json', label: 'Codex', enforces: true, experimental: true, rulesPath: 'docs/agent-rules', ruleExt: '.md', commandsPath: null, writeHooksConfig, removeHooksConfig, isWired, convertRule };

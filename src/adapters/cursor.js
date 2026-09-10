'use strict';
// Cursor adapter: .cursor/hooks.json (enforced), .cursor/rules/*.mdc, .cursor/commands/*.md.
// Verified against https://cursor.com/docs/hooks (Sept 2026): preToolUse matcher values are
// Write | Delete (edit tools); "ask" is honoured on beforeShellExecution but not on preToolUse;
// exit codes for shell commands come from postToolUse (tool_output JSON string), afterShellExecution has only output.
const fs = require('fs');
const path = require('path');

const OURS = '.agent-ready/hooks/';
function hookCmd(script) { return `node .agent-ready/hooks/${script} --runtime cursor`; }

function ourHooks(cfg) {
  return {
    sessionStart: [{ command: hookCmd('session-start.js') }],
    preToolUse: [{ matcher: 'Write|Delete', command: hookCmd('guard-write.js'), failClosed: true }],
    beforeReadFile: [{ command: hookCmd('guard-read.js'), failClosed: false }],
    beforeShellExecution: [{ command: hookCmd('guard-shell.js'), failClosed: true }],
    afterFileEdit: [{ command: hookCmd('track-edit.js') }],
    afterShellExecution: [{ command: hookCmd('track-checks.js') }],
    postToolUse: [{ matcher: 'Shell', command: hookCmd('track-checks.js') }],
    stop: [{ command: hookCmd('ensure-checks.js'), loop_limit: cfg.maxStopAttempts || 4, timeout: Math.ceil((cfg.checkTimeoutMs || 180000) / 1000) * (cfg.checks || []).length + 30 }],
  };
}

function readExisting(file) {
  if (!fs.existsSync(file)) return { existing: null, status: 'created' };
  try { return { existing: JSON.parse(fs.readFileSync(file, 'utf8')), status: 'updated' }; }
  catch (e) { throw new Error(`${file} is not valid JSON (${e.message}). Fix or remove it, then re-run — agent-ready never overwrites a hook config it cannot parse.`); }
}

function writeHooksConfig(root, cfg) {
  const file = path.join(root, '.cursor', 'hooks.json');
  const ours = ourHooks(cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { existing, status } = readExisting(file);
  let out = { version: 1, hooks: ours };
  if (existing) {
    const merged = { ...(existing.hooks || {}) };
    for (const [event, list] of Object.entries(ours)) {
      const foreign = (merged[event] || []).filter((h) => !String(h.command).includes(OURS));
      merged[event] = [...foreign, ...list];
    }
    out = { ...existing, version: existing.version || 1, hooks: merged };
  }
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  return { file: '.cursor/hooks.json', status };
}

function removeHooksConfig(root) {
  const file = path.join(root, '.cursor', 'hooks.json');
  if (!fs.existsSync(file)) return null;
  try {
    const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    const hooks = {};
    for (const [event, list] of Object.entries(existing.hooks || {})) {
      const foreign = list.filter((h) => !String(h.command).includes(OURS));
      if (foreign.length) hooks[event] = foreign;
    }
    if (Object.keys(hooks).length) { fs.writeFileSync(file, JSON.stringify({ ...existing, hooks }, null, 2) + '\n'); return { file: '.cursor/hooks.json', status: 'cleaned' }; }
    fs.unlinkSync(file); return { file: '.cursor/hooks.json', status: 'removed' };
  } catch { return null; }
}

function isWired(root) {
  const file = path.join(root, '.cursor', 'hooks.json');
  return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(OURS);
}

module.exports = { id: 'cursor', hooksFile: '.cursor/hooks.json', label: 'Cursor', enforces: true, experimental: false, rulesPath: '.cursor/rules', ruleExt: '.mdc', commandsPath: '.cursor/commands', writeHooksConfig, removeHooksConfig, isWired };

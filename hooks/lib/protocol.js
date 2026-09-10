'use strict';
// Normalises hook I/O across agent runtimes so every guard is written once.
//
// Runtime is passed as `--runtime <id>` by the generated hook config (argv, so it works on Windows).
// Supported: cursor, claude, codex, gemini, copilot. Falls back to payload heuristics.
//
// Input normalisation: editedPath / editedPaths / shellCommand / readPath look in every place a
// runtime puts them (tool_input.file_path, path, target_file, toolArgs, apply_patch text …).
// Output: deny / ask / followup / context produce the shape each runtime expects.
// If a vendor changes its schema, this is the only file to touch.

const fs = require('fs');
const os = require('os');
const path = require('path');

function argFlag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}

function readStdin() {
  try { const raw = fs.readFileSync(0, 'utf8'); return raw.trim() ? JSON.parse(raw) : {}; } catch { return {}; }
}

const RUNTIMES = ['cursor', 'claude', 'codex', 'gemini', 'copilot'];
function detectRuntime(input) {
  const explicit = (argFlag('runtime') || process.env.AGENT_READY_RUNTIME || '').toLowerCase();
  if (RUNTIMES.includes(explicit)) return explicit;
  if (input.toolName !== undefined && input.toolArgs !== undefined) return 'copilot';
  if (input.session_id && input.hook_event_name && /^[A-Z]/.test(input.hook_event_name)) return 'claude';
  if (input.conversation_id || input.workspace_roots) return 'cursor';
  return 'cursor';
}

// Walk up from a directory to the one that contains .agent-ready/config.json.
function findRoot(start) {
  if (!start) return null;
  let d = path.resolve(start);
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(d, '.agent-ready', 'config.json'))) return d;
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
  return null;
}

function projectRoot(input) {
  const explicit = argFlag('root') || process.env.AGENT_READY_ROOT;
  if (explicit) return path.resolve(explicit);
  const candidates = [
    Array.isArray(input.workspace_roots) && input.workspace_roots[0],
    input.cwd, process.env.CLAUDE_PROJECT_DIR, process.env.CURSOR_PROJECT_DIR, process.cwd(),
  ].filter(Boolean);
  for (const c of candidates) { const r = findRoot(c); if (r) return r; }
  return path.resolve(candidates[0] || process.cwd());
}

function sessionId(input) {
  return String(input.session_id || input.conversation_id || input.sessionId || input.generation_id || 'default').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
}

function toolInput(input) {
  const ti = input.tool_input || input.input || input.toolArgs || {};
  if (typeof ti === 'string') { try { return JSON.parse(ti); } catch { return { raw: ti }; } }
  return ti;
}
function toolName(input) { return String(input.tool_name || input.toolName || input.tool || ''); }

// Codex sends file edits as apply_patch with the patch text in tool_input.command / patch / input.
function patchPaths(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) out.push(m[1].trim());
  for (const m of String(text || '').matchAll(/^\*\*\* Move to: (.+)$/gm)) out.push(m[1].trim());
  return out;
}
function isPatchTool(input) { return /apply_patch|applypatch/i.test(toolName(input)); }

// Every file an edit/write tool is about to touch.
function editedPaths(input) {
  const ti = toolInput(input);
  if (isPatchTool(input)) {
    const text = ti.command || ti.patch || ti.input || ti.raw || '';
    return patchPaths(text);
  }
  const single = input.file_path || ti.file_path || ti.path || ti.target_file || ti.filePath || ti.notebook_path || ti.file || null;
  const many = Array.isArray(ti.files) ? ti.files.map((f) => (typeof f === 'string' ? f : f && (f.path || f.file_path))).filter(Boolean) : [];
  return [...(single ? [single] : []), ...many];
}
function editedPath(input) { return editedPaths(input)[0] || null; }

function readPath(input) {
  const ti = toolInput(input);
  return input.file_path || ti.file_path || ti.path || ti.target_file || ti.absolute_path || ti.filePath || null;
}

function shellCommand(input) {
  if (isPatchTool(input)) return null;
  const ti = toolInput(input);
  return input.command || ti.command || ti.cmd || ti.script || ti.raw || null;
}

function isEditTool(input) {
  const name = toolName(input).toLowerCase();
  if (!name) return editedPaths(input).length > 0;
  return /write|edit|replace|delete|create|notebook|str_replace|apply_patch|applypatch|write_file|insert|patch/.test(name);
}
function isShellTool(input) {
  const name = toolName(input).toLowerCase();
  if (isPatchTool(input)) return false;
  if (!name) return !!shellCommand(input);
  return /shell|bash|terminal|command|exec|powershell|^run$|run_/.test(name) && !/read|write|edit/.test(name);
}
function isReadTool(input) {
  const name = toolName(input).toLowerCase();
  if (!name) return !!readPath(input);
  return /^(read|read_file|readfile|view|open_file|view_file|cat)$/.test(name) || /beforereadfile/.test(name);
}

function relativeToRoot(root, p) {
  if (!p) return null;
  const abs = path.isAbsolute(p) ? p : path.resolve(root, p);
  return path.relative(root, abs).split(path.sep).join('/');
}

// Resolve symlinks for the deepest existing ancestor so `ln -s ../backend link && write link/x` is caught.
function realResolve(root, p) {
  if (!p) return null;
  let abs = path.isAbsolute(p) ? path.normalize(p) : path.resolve(root, p);
  let rest = [];
  let cur = abs;
  for (let i = 0; i < 64; i++) {
    try { const real = fs.realpathSync.native ? fs.realpathSync.native(cur) : fs.realpathSync(cur); return rest.length ? path.join(real, ...rest) : real; } catch { /* keep walking up */ }
    const parent = path.dirname(cur);
    if (parent === cur) return abs;
    rest.unshift(path.basename(cur));
    cur = parent;
  }
  return abs;
}
function realRoot(root) { try { return fs.realpathSync.native ? fs.realpathSync.native(root) : fs.realpathSync(root); } catch { return root; } }

const TMP_DIRS = [os.tmpdir(), '/tmp', '/private/tmp', '/var/tmp', process.env.TMPDIR, process.env.TEMP, process.env.TMP].filter(Boolean).map((d) => { try { return fs.realpathSync(d); } catch { return d; } });
function isInsideTmp(absPath) {
  if (!absPath) return false;
  return TMP_DIRS.some((t) => absPath === t || absPath.startsWith(t + path.sep));
}

// ---------- audit ----------
function audit(root, entry) {
  try {
    const p = path.join(root, '.agent-ready', 'audit.log');
    fs.appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch { /* best effort */ }
}

// ---------- responses ----------
function out(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

function deny(runtime, reason, event, meta) {
  if (meta && meta.root) audit(meta.root, { decision: 'deny', runtime, reason, ...meta, root: undefined });
  switch (runtime) {
    case 'claude':
    case 'codex':
      if (event === 'PreToolUse') { out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }); process.exit(0); }
      process.stderr.write(reason + '\n'); process.exit(2);
    // eslint-disable-next-line no-fallthrough
    case 'gemini':
      out({ decision: 'deny', reason }); process.exit(0);
    // eslint-disable-next-line no-fallthrough
    case 'copilot':
      out({ permissionDecision: 'deny', permissionDecisionReason: reason }); process.exit(0);
    // eslint-disable-next-line no-fallthrough
    default:
      out({ permission: 'deny', user_message: reason, agent_message: reason }); process.exit(0);
  }
}

function ask(runtime, reason, event, meta) {
  if (meta && meta.root) audit(meta.root, { decision: 'ask', runtime, reason, ...meta, root: undefined });
  switch (runtime) {
    case 'claude':
    case 'codex':
      out({ hookSpecificOutput: { hookEventName: event || 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } }); process.exit(0);
    // eslint-disable-next-line no-fallthrough
    case 'gemini': // no documented "ask" — be conservative
      out({ decision: 'deny', reason: reason + ' (ask a human, then re-run with their approval)' }); process.exit(0);
    // eslint-disable-next-line no-fallthrough
    case 'copilot':
      out({ permissionDecision: 'ask', permissionDecisionReason: reason }); process.exit(0);
    // eslint-disable-next-line no-fallthrough
    default:
      out({ permission: 'ask', user_message: reason, agent_message: reason }); process.exit(0);
  }
}

function allow() { process.exit(0); }

function followup(runtime, message) {
  switch (runtime) {
    case 'claude': case 'codex': case 'gemini': out({ decision: 'block', reason: message }); process.exit(0);
    // eslint-disable-next-line no-fallthrough
    case 'copilot': process.stderr.write(message + '\n'); process.exit(2);
    // eslint-disable-next-line no-fallthrough
    default: out({ followup_message: message }); process.exit(0);
  }
}

function context(runtime, text) {
  switch (runtime) {
    case 'claude': case 'codex': out({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } }); process.exit(0);
    // eslint-disable-next-line no-fallthrough
    case 'gemini': case 'copilot': process.stdout.write(text + '\n'); process.exit(0);
    // eslint-disable-next-line no-fallthrough
    default: out({ additional_context: text }); process.exit(0);
  }
}

function done() { process.exit(0); }

module.exports = {
  RUNTIMES, readStdin, detectRuntime, projectRoot, findRoot, sessionId,
  toolName, toolInput, editedPath, editedPaths, readPath, shellCommand, patchPaths,
  isEditTool, isShellTool, isReadTool, relativeToRoot, realResolve, realRoot, isInsideTmp,
  audit, deny, ask, allow, followup, context, done,
};

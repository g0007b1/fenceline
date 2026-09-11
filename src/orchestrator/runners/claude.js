'use strict';
// Claude Code runner: spawns `claude -p` (headless / print mode) and normalises its JSON result.
// Verified against `claude --help` 2.1.x: --output-format json|stream-json, --json-schema, --permission-mode,
// --allowedTools with path patterns (Write(docs/**)), --max-turns, --max-budget-usd, --agents, --resume,
// --append-system-prompt, --settings, --include-hook-events, --model, --effort, --no-session-persistence.
const { spawn, spawnSync } = require('child_process');

const id = 'claude';
const label = 'Claude Code';
const bin = process.env.FENCELINE_CLAUDE_BIN || 'claude';

function detect() {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000 });
  if (r.status !== 0) return { installed: false };
  return { installed: true, version: (r.stdout || '').trim().split('\n')[0] };
}

function authHint() { return 'Claude Code is not logged in. Run `claude auth login` (or set ANTHROPIC_API_KEY) and retry.'; }

// opts: { cwd, prompt, system, appendSystem, schema, allowedTools[], disallowedTools[], permissionMode, maxTurns,
//         maxBudgetUsd, model, effort, resume, sessionId, agents{}, settings, includeHookEvents, onEvent(fn), timeoutMs }
function run(opts) {
  return new Promise((resolve) => {
    const args = ['-p', '--output-format', opts.includeHookEvents ? 'stream-json' : 'json', '--verbose'];
    if (opts.schema) args.push('--json-schema', JSON.stringify(opts.schema));
    if (opts.system) args.push('--system-prompt', opts.system);
    if (opts.appendSystem) args.push('--append-system-prompt', opts.appendSystem);
    if (opts.allowedTools && opts.allowedTools.length) args.push('--allowedTools', ...opts.allowedTools);
    if (opts.disallowedTools && opts.disallowedTools.length) args.push('--disallowedTools', ...opts.disallowedTools);
    args.push('--permission-mode', opts.permissionMode || 'dontAsk');
    if (opts.maxTurns) args.push('--max-turns', String(opts.maxTurns));
    if (opts.maxBudgetUsd) args.push('--max-budget-usd', String(opts.maxBudgetUsd));
    if (opts.model) args.push('--model', opts.model);
    if (opts.effort) args.push('--effort', opts.effort);
    if (opts.resume) args.push('--resume', opts.resume);
    if (opts.sessionId) args.push('--session-id', opts.sessionId);
    if (opts.agents) args.push('--agents', JSON.stringify(opts.agents));
    if (opts.settings) args.push('--settings', typeof opts.settings === 'string' ? opts.settings : JSON.stringify(opts.settings));
    if (opts.settingSources) args.push('--setting-sources', opts.settingSources);
    if (opts.includeHookEvents) args.push('--include-hook-events');
    if (opts.noPersist) args.push('--no-session-persistence');
    args.push(opts.prompt);

    const started = Date.now();
    const child = spawn(bin, args, { cwd: opts.cwd, env: { ...process.env, CLAUDE_CODE_NO_TELEMETRY: process.env.CLAUDE_CODE_NO_TELEMETRY || '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const events = [];
    let buf = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      out += s;
      if (!opts.includeHookEvents) return;
      buf += s;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const ev = JSON.parse(line); events.push(ev); if (opts.onEvent) opts.onEvent(ev); } catch { /* not json */ }
      }
    });
    child.stderr.on('data', (d) => { err += d.toString(); });
    const timer = setTimeout(() => { child.kill('SIGTERM'); }, opts.timeoutMs || 30 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let result = null;
      if (opts.includeHookEvents) result = events.find((e) => e.type === 'result') || null;
      else { try { result = JSON.parse(out); } catch { result = null; } }
      const isError = !result || result.is_error === true || (code !== 0 && !(result && result.structured_output)) || /^error_/.test((result && result.subtype) || '');
      const text = result ? (typeof result.result === 'string' ? result.result : JSON.stringify(result.result)) : (out || err).trim();
      let json = null;
      if (result && result.structured_output !== undefined) json = result.structured_output;
      else if (opts.schema && result && typeof result.result === 'string') { try { json = JSON.parse(result.result); } catch { json = extractJson(result.result); } }
      const authFail = /authenticat|OAuth|login|API key/i.test(text) && isError;
      resolve({
        ok: !isError, text, json, events,
        sessionId: result && result.session_id, costUsd: result && result.total_cost_usd, turns: result && result.num_turns,
        durationMs: Date.now() - started, exitCode: code, stderr: err.trim(), authFail, raw: result,
      });
    });
  });
}

function extractJson(s) {
  const m = String(s).match(/```json\s*([\s\S]*?)```/) || String(s).match(/(\{[\s\S]*\})/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// Tool permission strings for the phases. Paths are relative to cwd.
function toolsReadOnly() { return ['Read', 'Glob', 'Grep', 'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git show:*)', 'Bash(git blame:*)', 'Bash(git status:*)', 'Bash(git ls-files:*)', 'Bash(ls:*)', 'Bash(wc:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(rg:*)', 'Bash(find:*)']; }
function toolsWrite(paths) { return [...toolsReadOnly(), ...paths.flatMap((p) => [`Write(${p})`, `Edit(${p})`])]; }

module.exports = { id, label, bin, detect, run, authHint, toolsReadOnly, toolsWrite, experimental: false };

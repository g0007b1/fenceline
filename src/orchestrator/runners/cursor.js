'use strict';
// Cursor CLI runner: `agent -p --force --trust --workspace <dir> --output-format json "<prompt>"`.
// From https://cursor.com/docs/cli/headless (2026-09): result {type:"result", subtype, is_error, result, session_id};
// no JSON-schema output (we extract JSON from the text), no turn/budget caps, no system-prompt flag,
// no path-scoped tool allowlist (print mode has all tools; the prompt states the write scope).
// Status: wired from the docs, not verified against a live session → experimental.
const { spawn, spawnSync } = require('child_process');

const id = 'cursor';
const label = 'Cursor CLI';
const bin = process.env.FENCELINE_CURSOR_BIN || (spawnSync('agent', ['--version'], { encoding: 'utf8' }).status === 0 ? 'agent' : 'cursor-agent');

function detect() {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000 });
  if (r.status !== 0) return { installed: false };
  return { installed: true, version: (r.stdout || '').trim().split('\n')[0] };
}
function authHint() { return 'Cursor CLI is not authenticated. Run `agent login` or set CURSOR_API_KEY and retry.'; }

function run(opts) {
  return new Promise((resolve) => {
    const args = ['-p', '--trust', '--output-format', 'json', '--workspace', opts.cwd];
    if (opts.permissionMode !== 'dontAsk') args.push('--force');
    if (opts.model) args.push('--model', opts.model);
    if (opts.resume) args.push('--resume', opts.resume);
    const scope = opts.schema ? `\n\nAnswer ONLY with a JSON object matching this JSON Schema (no prose, no code fence):\n${JSON.stringify(opts.schema)}` : '';
    const ro = opts.permissionMode === 'dontAsk' ? '\n\nThis phase is read-only: do not create, edit or delete files and do not run commands that change state.' : '';
    args.push((opts.system ? opts.system + '\n\n' : '') + opts.prompt + ro + scope);
    const started = Date.now();
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs || 30 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let result = null; try { result = JSON.parse(out); } catch { const m = out.match(/\{[\s\S]*\}\s*$/); if (m) { try { result = JSON.parse(m[0]); } catch { /* ignore */ } } }
      const text = result && typeof result.result === 'string' ? result.result : (out || err).trim();
      const isError = !result || result.is_error === true || code !== 0;
      let json = null;
      if (opts.schema) { try { json = JSON.parse(text); } catch { const m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/); if (m) { try { json = JSON.parse(m[1]); } catch { json = null; } } } }
      resolve({ ok: !isError, text, json, events: [], sessionId: result && result.session_id, costUsd: null, turns: null, durationMs: Date.now() - started, exitCode: code, stderr: err.trim(), authFail: isError && /auth|login|api key/i.test(text + err), raw: result });
    });
  });
}

function toolsReadOnly() { return []; }
function toolsWrite() { return []; }

module.exports = { id, label, bin, detect, run, authHint, toolsReadOnly, toolsWrite, experimental: true };

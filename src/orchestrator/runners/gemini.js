'use strict';
// Gemini CLI runner: `gemini -p "<prompt>" --approval-mode yolo --output-format json [-m model]`.
// From https://geminicli.com/docs/cli/headless/ (2026-09): json → {response, stats, error?}; exit 0/1/42/53.
// No JSON-schema output (JSON is extracted from the response), no turn/budget caps, system prompt only via
// GEMINI_SYSTEM_MD (full replacement — not used). Read-only phases are enforced by instruction only.
// Status: wired from the docs, not verified against a live session → experimental.
const { spawn, spawnSync } = require('child_process');

const id = 'gemini';
const label = 'Gemini CLI';
const bin = process.env.FENCELINE_GEMINI_BIN || 'gemini';

function detect() {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000 });
  if (r.status !== 0) return { installed: false };
  return { installed: true, version: (r.stdout || '').trim().split('\n')[0] };
}
function authHint() { return 'Gemini CLI is not authenticated. Run `gemini` once to log in, or set GEMINI_API_KEY.'; }

function run(opts) {
  return new Promise((resolve) => {
    const args = ['-p', '', '--approval-mode', 'yolo', '--output-format', 'json'];
    if (opts.model) args.push('-m', opts.model);
    const scope = opts.schema ? `\n\nAnswer ONLY with a JSON object matching this JSON Schema (no prose, no code fence):\n${JSON.stringify(opts.schema)}` : '';
    const ro = opts.permissionMode === 'dontAsk' ? '\n\nThis phase is read-only: do not create, edit or delete files and do not run commands that change state.' : '';
    args[1] = (opts.system ? opts.system + '\n\n' : '') + opts.prompt + ro + scope;
    const started = Date.now();
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs || 30 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let result = null; try { result = JSON.parse(out); } catch { const m = out.match(/\{[\s\S]*\}\s*$/); if (m) { try { result = JSON.parse(m[0]); } catch { /* ignore */ } } }
      const text = result && typeof result.response === 'string' ? result.response : (out || err).trim();
      const isError = code !== 0 || !result || !!result.error;
      let json = null;
      if (opts.schema) { try { json = JSON.parse(text); } catch { const m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/); if (m) { try { json = JSON.parse(m[1]); } catch { json = null; } } } }
      resolve({ ok: !isError, text, json, events: [], sessionId: null, costUsd: null, turns: null, durationMs: Date.now() - started, exitCode: code, stderr: err.trim(), authFail: isError && /auth|login|api key/i.test(text + err), raw: result });
    });
  });
}

function toolsReadOnly() { return []; }
function toolsWrite() { return []; }

module.exports = { id, label, bin, detect, run, authHint, toolsReadOnly, toolsWrite, experimental: true };

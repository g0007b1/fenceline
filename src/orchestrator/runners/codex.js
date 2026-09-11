'use strict';
// Codex CLI runner: `codex exec -C <dir> -s read-only|workspace-write -a never --skip-git-repo-check --json [--output-schema f -o out] "<prompt>"`.
// From https://learn.chatgpt.com/docs/non-interactive-mode (2026-09): --json streams JSONL (thread.started, item.completed
// with agent_message, turn.completed with usage, turn.failed); --output-schema constrains the final message.
// Status: wired from the docs, not verified against a live session → experimental.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const id = 'codex';
const label = 'Codex CLI';
const bin = process.env.FENCELINE_CODEX_BIN || 'codex';

function detect() {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000 });
  if (r.status !== 0) return { installed: false };
  return { installed: true, version: (r.stdout || '').trim().split('\n')[0] };
}
function authHint() { return 'Codex is not logged in. Run `codex login` or set CODEX_API_KEY and retry.'; }

function run(opts) {
  return new Promise((resolve) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fenceline-codex-'));
    const args = ['exec', '-C', opts.cwd, '-s', opts.permissionMode === 'dontAsk' ? 'read-only' : 'workspace-write', '-a', 'never', '--skip-git-repo-check', '--json'];
    if (opts.model) args.push('-m', opts.model);
    let outFile = null;
    if (opts.schema) { const sf = path.join(tmp, 'schema.json'); fs.writeFileSync(sf, JSON.stringify(opts.schema)); outFile = path.join(tmp, 'out.json'); args.push('--output-schema', sf, '-o', outFile); }
    args.push((opts.system ? opts.system + '\n\n' : '') + opts.prompt);
    const started = Date.now();
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs || 30 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const events = out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const messages = events.filter((e) => e.type === 'item.completed' && e.item && e.item.type === 'agent_message').map((e) => e.item.text);
      const failed = events.find((e) => e.type === 'turn.failed' || e.type === 'error');
      const text = messages[messages.length - 1] || (failed ? JSON.stringify(failed) : (out || err).trim());
      let json = null;
      if (opts.schema) { try { json = JSON.parse(outFile && fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : text); } catch { json = null; } }
      const thread = events.find((e) => e.type === 'thread.started');
      const usage = (events.find((e) => e.type === 'turn.completed') || {}).usage;
      fs.rmSync(tmp, { recursive: true, force: true });
      const isError = code !== 0 || !!failed;
      resolve({ ok: !isError, text, json, events, sessionId: thread && thread.thread_id, costUsd: null, turns: null, usage, durationMs: Date.now() - started, exitCode: code, stderr: err.trim(), authFail: isError && /auth|login|api key/i.test(text + err), raw: events });
    });
  });
}

function toolsReadOnly() { return []; }
function toolsWrite() { return []; }

module.exports = { id, label, bin, detect, run, authHint, toolsReadOnly, toolsWrite, experimental: true };

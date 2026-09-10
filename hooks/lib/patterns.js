'use strict';
// Config is JSON, so patterns are stored as {source, flags}. This turns them back into RegExps
// and hosts the path classifiers shared by guard-write and guard-shell.
const path = require('path');

const CASE_INSENSITIVE_FS = process.platform === 'darwin' || process.platform === 'win32';

function toRegExps(list) {
  return (list || []).map((p) => {
    const flags = (p.flags || '') + (CASE_INSENSITIVE_FS && !(p.flags || '').includes('i') ? 'i' : '');
    return p instanceof RegExp ? p : new RegExp(p.source, flags);
  });
}
function toShellRules(list) {
  return (list || []).map((r) => ({ re: new RegExp(r.source, r.flags || ''), why: r.why, severity: r.severity || 'deny' }));
}

// The enforcement machinery itself. Always protected, regardless of preset.
const TOOLING_RE = /^(\.fenceline(\/|$)|\.claude\/settings(\.local)?\.json$|\.claude$|\.cursor\/hooks\.json$|\.cursor$|\.codex\/hooks\.json$|\.codex$|\.gemini\/settings\.json$|\.gemini$|\.github\/hooks(\/|$))/i;
function isTooling(rel) { return TOOLING_RE.test(rel); }

const esc = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

// "npm run lint" also matches "pnpm lint" / "yarn run lint"; "ruff check ." matches "uv run ruff check .".
function checkMatcher(command) {
  const tokens = String(command || '').trim().split(/\s+/);
  if (!tokens.length || !tokens[0]) return /$^/;
  const pm = ['npm', 'pnpm', 'yarn', 'bun'];
  if (pm.includes(tokens[0]) && (tokens[1] === 'run' || tokens[1] === 'run-script')) {
    const script = esc(tokens.slice(2).join(' '));
    return new RegExp(`^(npm|pnpm|yarn|bun)\\s+(run(-script)?\\s+)?${script}(\\s|$)`);
  }
  return new RegExp(`(^|\\s)${tokens.map(esc).join('\\s+')}(\\s|$)`);
}

function codeFileRegExp(cfg) {
  const p = cfg && cfg.codeFilePattern;
  if (p && p.source) return new RegExp(p.source, p.flags || '');
  return /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|py|go|rs|java|kt|kts|swift|rb|php|cs|c|cc|cpp|h|hpp|scala|ex|exs|dart)$/;
}

// Failure markers for runtimes that do not report an exit code.
const FAIL_MARKERS = /(✖\s*[1-9]|\berror TS\d+|--- FAIL\b|\bFAILED\b|error\[E\d+\]|Found [1-9]\d* errors?|\b[1-9]\d* errors?\b|Traceback \(most recent call last\)|npm ERR!|ELIFECYCLE|error: could not compile|\bmypy: error|\bE\d{3}\b.*\bline\b)/;

// Classify a repo-relative path against the config. Returns null or { kind, why }.
function classify(cfg, rel, absPath, ctx) {
  if (!rel) return null;
  if (isTooling(rel)) return { kind: 'tooling', why: 'the fenceline hooks and runtime hook config are never edited by agents' };
  for (const sib of cfg.siblings || []) {
    const sibRoot = path.resolve(ctx.root, sib);
    if (absPath === sibRoot || absPath.startsWith(sibRoot + path.sep)) return { kind: 'sibling', why: `${sib} is a read-only sibling repository — write a handoff in docs/handoffs/ instead` };
  }
  for (const re of ctx.denyWrite) if (re.test(rel)) return { kind: 'protected', why: cfg.denyWriteHint || 'this path is human-only; describe the change in your answer instead' };
  if (rel.startsWith('../') || rel.startsWith('..\\')) {
    const allowed = ctx.isInsideTmp(absPath) || (cfg.allowOutsideRoot || []).some((prefix) => rel.startsWith(prefix) || absPath.startsWith(prefix));
    if (!allowed) return { kind: 'outside', why: 'writing outside this repository is not allowed' };
  }
  return null;
}

function isSecret(ctx, rel) { return ctx.denyRead.some((re) => re.test(rel)); }

module.exports = { toRegExps, toShellRules, checkMatcher, codeFileRegExp, FAIL_MARKERS, TOOLING_RE, isTooling, classify, isSecret, CASE_INSENSITIVE_FS };

'use strict';
// Fragile zones from git history: directories with high churn, many bug-fix commits and many authors.
// Those are the places where a newcomer (human or agent) breaks things — they get a domain doc.
const { execSync } = require('child_process');

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.expo', 'android', 'ios', '.turbo', '.cache', 'out', 'vendor', '.agent-ready', 'target', '__pycache__', '.venv', 'venv']);
const FIX_RE = /\b(fix|bug|hotfix|regress|revert|broken|crash|patch)\b/i;
const NOISE_RE = /\.(lock|snap|min\.js|map|png|jpg|jpeg|gif|svg|webp|ico|pdf)$|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|uv\.lock|Cargo\.lock|go\.sum/;

function sh(cmd, cwd) {
  try { return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return ''; }
}

// Group by a directory deep enough to be meaningful: src/<a>/<b> under src-like roots, else <a>/<b>.
const SRC_ROOTS = new Set(['src', 'app', 'lib', 'pkg', 'internal', 'cmd', 'packages', 'apps', 'services', 'modules']);
// Tests, docs and CI churn a lot but are not "fragile zones" — the code they cover is.
const NOT_ZONES = /^(__tests__|tests?|spec|e2e|cypress|docs?|\.github|\.gitlab|scripts?|fixtures?|examples?|assets|public|static)$/i;
function zoneKey(file) {
  const parts = file.split('/');
  if (parts.length < 2 || NOT_ZONES.test(parts[0])) return null;
  // src/<a>/<b>/file → src/a/b ; src/<a>/file → src/a ; <a>/<b>/file → a/b ; <a>/file → a
  if (SRC_ROOTS.has(parts[0])) {
    if (parts.length === 2) return null;
    if (NOT_ZONES.test(parts[1])) return null;
    return parts.length >= 4 ? `${parts[0]}/${parts[1]}/${parts[2]}` : `${parts[0]}/${parts[1]}`;
  }
  return parts.length >= 3 ? `${parts[0]}/${parts[1]}` : parts[0];
}

function detectFragileZones(root, { since = '18 months ago', minCommits = 8, limit = 8 } = {}) {
  const log = sh(`git log --since="${since}" --name-only --pretty=format:"%H%x1f%an%x1f%s" -- .`, root);
  if (!log) return { available: false, zones: [] };
  const stats = new Map();
  let current = null;
  const seenInCommit = new Set();
  for (const line of log.split('\n')) {
    if (!line.trim()) continue;
    if (/^[0-9a-f]{40}\x1f/.test(line)) {
      const [, author, subject] = line.split('\x1f');
      current = { author, fix: FIX_RE.test(subject) };
      seenInCommit.clear();
      continue;
    }
    if (!current || NOISE_RE.test(line)) continue;
    const parts = line.split('/');
    if (IGNORE.has(parts[0])) continue;
    const key = zoneKey(line);
    if (!key || seenInCommit.has(key)) { if (key) { const s = stats.get(key); if (s) s.files.add(line); } continue; }
    seenInCommit.add(key);
    const s = stats.get(key) || { commits: 0, fixes: 0, authors: new Set(), files: new Set() };
    s.commits += 1; if (current.fix) s.fixes += 1; s.authors.add(current.author); s.files.add(line);
    stats.set(key, s);
  }
  const zones = [...stats.entries()]
    .map(([dir, s]) => ({ dir, commits: s.commits, fixes: s.fixes, authors: s.authors.size, files: s.files.size, score: s.commits + s.fixes * 3 + s.authors.size * 2 }))
    .filter((z) => z.commits >= minCommits)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { available: true, zones };
}

module.exports = { detectFragileZones, IGNORE };

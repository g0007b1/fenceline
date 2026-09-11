'use strict';
// Small helpers shared by the pipeline and enforce (kept apart to avoid a require cycle).

// Glob (relative to repo root) → anchored regex source. Supports **, *, ?, trailing "/" (= dir and below).
function globToRegex(glob) {
  let g = String(glob).trim().replace(/^\.\//, '');
  if (g.endsWith('/')) g += '**';
  let out = '^';
  for (let i = 0; i < g.length; i++) {
    if (g.startsWith('**/', i)) { out += '(?:.*/)?'; i += 2; continue; }
    if (g.startsWith('**', i)) { out += '.*'; i += 1; continue; }
    const c = g[i];
    if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += /[.+^${}()|[\]\\]/.test(c) ? '\\' + c : c;
  }
  return out + '$';
}
function slug(dir) { return dir.replace(/^(src|app|lib|pkg|internal|packages|apps)\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(); }
module.exports = { globToRegex, slug };

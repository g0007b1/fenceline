'use strict';
// Deterministic checks on a diagnosis before any agent spends turns on it:
//   verify  — every path / commit / script a claim cites must exist; claims with no surviving evidence are demoted
//   dedupe  — the same convention / entity / landmine stated twice by different area agents becomes one
// Nothing here calls an API. Returns the cleaned diagnosis plus a report of what was demoted or merged.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PATH_RE = /([A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@\-[\]()]+)+(?:\.[A-Za-z0-9]+)?)(?::\d+(?:-\d+)?)?/g;
const SHA_RE = /\b[0-9a-f]{7,40}\b/g;

function pathsIn(text) { return [...String(text || '').matchAll(PATH_RE)].map((m) => m[1]).filter((p) => !/^https?:/.test(p) && !p.startsWith('@/')); }
function shasIn(text) { return [...String(text || '').matchAll(SHA_RE)].map((m) => m[0]); }

function makeChecker(root) {
  const seen = new Map();
  const exists = (p) => { if (seen.has(p)) return seen.get(p); const ok = fs.existsSync(path.join(root, p)); seen.set(p, ok); return ok; };
  const shaOk = (sha) => { const k = 'sha:' + sha; if (seen.has(k)) return seen.get(k); let ok = false; try { execSync(`git cat-file -e ${sha}^{commit}`, { cwd: root, stdio: 'ignore', timeout: 3000 }); ok = true; } catch { ok = false; } seen.set(k, ok); return ok; };
  // evidence string → { ok, missing[] } ; ok when at least one cited path or sha exists (or nothing citable was found)
  const evidence = (text) => {
    const ps = pathsIn(text), ss = shasIn(text).filter((s) => !ps.some((p) => p.includes(s)));
    if (!ps.length && !ss.length) return { ok: null, missing: [] };
    const missing = [...ps.filter((p) => !exists(p)), ...ss.filter((s) => !shaOk(s))];
    return { ok: missing.length < ps.length + ss.length, missing };
  };
  return { exists, shaOk, evidence };
}

function verify(root, d) {
  const c = makeChecker(root);
  const report = { demoted: [], dropped: [], flagged: [] };
  const out = JSON.parse(JSON.stringify(d));
  out.openQuestions = out.openQuestions || [];

  // conventions: keep those with at least one existing evidence path; otherwise demote to open question
  out.conventions = (out.conventions || []).filter((cv) => {
    const ev = (cv.evidence || []).map((e) => c.evidence(e));
    const cited = ev.filter((e) => e.ok !== null);
    if (cited.length && !cited.some((e) => e.ok)) { report.demoted.push(`convention "${cv.rule.slice(0, 80)}" — evidence not found: ${cited.flatMap((e) => e.missing).slice(0, 3).join(', ')}`); out.openQuestions.push(`Unverified convention (cited files not found): ${cv.rule}`); return false; }
    cv.verified = cited.length ? true : false;
    return true;
  });
  // entities: drop when none of the "where" paths exist
  out.entities = (out.entities || []).filter((en) => {
    const where = (en.where || []).flatMap(pathsIn);
    if (where.length && !where.some((p) => c.exists(p))) { report.dropped.push(`entity "${en.term}" — none of ${where.slice(0, 3).join(', ')} exist`); return false; }
    return true;
  });
  // fragile zones: directory must exist; invariants keep a verified flag
  out.fragileZones = (out.fragileZones || []).filter((z) => {
    if (!c.exists(z.dir)) { report.dropped.push(`fragile zone "${z.dir}" — directory does not exist`); return false; }
    z.invariants = (z.invariants || []).map((inv) => { const e = c.evidence(inv.evidence); if (e.ok === false) report.flagged.push(`invariant in ${z.dir}: "${inv.statement.slice(0, 70)}" cites missing ${e.missing.slice(0, 2).join(', ')}`); return { ...inv, verified: e.ok }; });
    return true;
  });
  // landmines: flag when the "where" does not exist
  out.landmines = (out.landmines || []).map((l) => { const e = c.evidence(l.where); if (e.ok === false) report.flagged.push(`landmine "${l.what.slice(0, 60)}" cites missing ${e.missing.slice(0, 2).join(', ')}`); return { ...l, verified: e.ok }; });
  // checks: the script must exist in package.json / Makefile when the command names one
  const pkg = c.exists('package.json') ? JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) : null;
  out.checks = (out.checks || []).map((ch) => {
    const m = String(ch.command || '').match(/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:-]+)/);
    if (m && pkg && !(pkg.scripts || {})[m[1]]) { report.flagged.push(`check "${ch.command}" — no such script in package.json`); return { ...ch, verified: false, note: `${ch.note || ''} [script not found in package.json]`.trim() }; }
    return ch;
  });
  // protected paths: a glob that matches nothing is suspicious but harmless; note it
  return { diagnosis: out, report };
}

// ---------- dedupe ----------
const norm = (s) => String(s || '').toLowerCase().replace(/[`'"*_.,;:()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
function jaccard(a, b) { const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); }
function pathSet(list) { return new Set((list || []).flatMap(pathsIn).map((p) => p.replace(/:\d+.*$/, ''))); }
function setJaccard(A, B) { if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); }

function dedupe(d) {
  const out = JSON.parse(JSON.stringify(d));
  const report = { conventions: 0, entities: 0, landmines: 0, openQuestions: 0, protectedPaths: 0 };
  // conventions: same evidence files or very similar wording → merge, keep the longer rule text and the union of evidence
  const convs = [];
  for (const cv of out.conventions || []) {
    const ps = pathSet(cv.evidence);
    const hit = convs.find((k) => jaccard(k.rule, cv.rule) >= 0.55 || (ps.size && setJaccard(pathSet(k.evidence), ps) >= 0.6 && jaccard(k.rule, cv.rule) >= 0.25));
    if (hit) { report.conventions++; hit.evidence = [...new Set([...(hit.evidence || []), ...(cv.evidence || [])])]; if ((cv.rule || '').length > (hit.rule || '').length) hit.rule = cv.rule; if (['mixed', 'consistent', 'universal'].indexOf(cv.strength) < ['mixed', 'consistent', 'universal'].indexOf(hit.strength)) hit.strength = cv.strength; continue; }
    convs.push(cv);
  }
  out.conventions = convs;
  // entities: same term (case / plural-insensitive)
  const ents = [];
  for (const en of out.entities || []) {
    const key = norm(en.term).replace(/s$/, '');
    const hit = ents.find((k) => norm(k.term).replace(/s$/, '') === key);
    if (hit) { report.entities++; hit.where = [...new Set([...(hit.where || []), ...(en.where || [])])]; hit.avoid = [...new Set([...(hit.avoid || []), ...(en.avoid || [])])]; if ((en.meaning || '').length > (hit.meaning || '').length) hit.meaning = en.meaning; continue; }
    ents.push(en);
  }
  out.entities = ents;
  // landmines: same location + similar text
  const mines = [];
  for (const l of out.landmines || []) {
    const hit = mines.find((k) => jaccard(k.what, l.what) >= 0.5 || (setJaccard(pathSet([k.where]), pathSet([l.where])) >= 0.99 && jaccard(k.what, l.what) >= 0.3));
    if (hit) { report.landmines++; if ((l.howToAvoid || '').length > (hit.howToAvoid || '').length) hit.howToAvoid = l.howToAvoid; continue; }
    mines.push(l);
  }
  out.landmines = mines;
  // open questions / undocumented: near-duplicates
  const uniqText = (list, key) => { const kept = []; for (const q of list || []) { if (kept.some((k) => jaccard(k, q) >= 0.6)) { report[key]++; continue; } kept.push(q); } return kept; };
  out.openQuestions = uniqText(out.openQuestions, 'openQuestions');
  out.undocumented = uniqText(out.undocumented, 'openQuestions');
  // protected paths: same glob
  const seenGlob = new Set();
  out.protectedPaths = (out.protectedPaths || []).filter((p) => { const g = String(p.glob || '').trim(); if (seenGlob.has(g)) { report.protectedPaths++; return false; } seenGlob.add(g); return true; });
  return { diagnosis: out, report };
}

// After compose: which paths do the written docs cite that do not exist? Handed to the critic as pre-checked findings.
function verifyDocs(root, files) {
  const c = makeChecker(root);
  const findings = [];
  for (const f of files) {
    let text; try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    const missing = [...new Set(pathsIn(text.replace(/```[\s\S]*?```/g, '')))].filter((p) => /\//.test(p) && !/^(docs\/(adr|handoffs)\/|\.fenceline\/)/.test(p) && !c.exists(p));
    const badShas = [...new Set(shasIn(text))].filter((s) => s.length >= 7 && !/^\d+$/.test(s) && !c.shaOk(s));
    if (missing.length || badShas.length) findings.push({ file: f, missingPaths: missing.slice(0, 12), unknownCommits: badShas.slice(0, 8) });
  }
  return findings;
}

module.exports = { verify, dedupe, verifyDocs, pathsIn };

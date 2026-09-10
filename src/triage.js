'use strict';
// triage: may this task be done autonomously? A deterministic first opinion from the same
// signals the scanner found (risk zones, protected paths, fragile zones) plus keyword heuristics.
// It is a pre-filter for an orchestrator (bot, CI, cloud agent); the agent still applies the safe-list.
const fs = require('fs');
const path = require('path');
const { getPreset } = require('./presets');
const { toRegExps } = require('../hooks/lib/patterns');

const RISK_WORDS = {
  payments: ['payment', 'billing', 'checkout', 'invoice', 'refund', 'stripe', 'оплат', 'платеж', 'платёж', 'счёт', 'возврат'],
  auth: ['auth', 'login', 'logout', 'session', 'oauth', 'password', 'permission', 'jwt', 'авториз', 'логин', 'сесси', 'парол', 'права'],
  push: ['push notification', 'push', 'fcm', 'apns', 'пуш'],
  deeplinks: ['deep link', 'deeplink', 'universal link', 'app link', 'диплинк'],
  native: ['native', 'android/', 'ios/', 'info.plist', 'manifest', 'plugin', 'eas ', 'prebuild', 'нативн'],
  migrations: ['migration', 'schema', 'database', ' db ', 'add column', 'new column', 'drop column', 'alter table', 'create table', 'new table', 'миграц', 'схем', 'базу данных', 'базе данных', ' бд', 'колонк', 'новую таблиц'],
  secrets: ['secret', 'credential', 'api key', 'token', '.env', 'секрет', 'ключ'],
  infra: ['deploy', 'pipeline', 'ci', 'docker', 'terraform', 'kubernetes', 'helm', 'деплой', 'пайплайн'],
  realtime: ['socket', 'websocket', 'offline cache', 'sync protocol', 'сокет', 'оффлайн-кэш'],
  jobs: ['queue', 'worker', 'cron', 'job', 'retry', 'очеред', 'воркер', 'крон'],
  email: ['email template', 'send email', 'sms', 'письм', 'рассылк'],
};
const NEW_LAYER = ['new ', 'add integration', 'integrate', 'introduce', 'from scratch', 'rewrite', 'redesign', 'migrate to', 'replace', 'switch to', 'новый', 'новую', 'внедрить', 'интегрир', 'с нуля', 'переписать', 'перейти на', 'заменить'];
const CONTEXT_ONLY = ['when offline', 'in offline', 'after login', 'when logged', 'after payment', 'on the payment screen', 'оффлайн', 'после входа', 'после оплаты', 'на экране'];

function tokens(text) { return text.toLowerCase(); }
function hits(text, words) { return words.filter((w) => text.includes(w.toLowerCase())); }

function triage(root, text) {
  const t = tokens(text);
  const profilePath = path.join(root, '.agent-ready', 'profile.json');
  const cfgPath = path.join(root, '.agent-ready', 'config.json');
  const profile = fs.existsSync(profilePath) ? JSON.parse(fs.readFileSync(profilePath, 'utf8')) : null;
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : null;
  const preset = getPreset(cfg ? cfg.preset : (profile ? profile.preset : 'generic'));

  const reasons = [];
  let human = 0, auto = 0;

  // 1. explicit paths in the task
  const paths = [...new Set([...t.matchAll(/@?((?:[\w.-]+\/)+[\w.-]+)/g)].map((m) => m[1]).filter((p) => !p.startsWith('http')))];
  const denyRes = cfg ? toRegExps(cfg.denyWrite) : [];
  for (const p of paths) {
    if (denyRes.some((re) => re.test(p))) { human += 3; reasons.push(`mentions protected path \`${p}\``); }
  }
  const fragile = profile && profile.fragile ? profile.fragile.zones : [];
  const zonesHit = fragile.filter((z) => paths.some((p) => p.startsWith(z.dir)) || t.includes(z.dir.split('/').pop().toLowerCase()));
  if (paths.length) { auto += 1; reasons.push(`names concrete paths (${paths.slice(0, 3).join(', ')})`); }

  // 2. risk zones present in this repo × words in the task
  const repoRisks = profile ? profile.risks.map((r) => r.id) : Object.keys(RISK_WORDS);
  const riskHits = [];
  for (const id of repoRisks) { const h = hits(t, RISK_WORDS[id] || []); if (h.length) riskHits.push({ id, words: h }); }
  const contextOnly = hits(t, CONTEXT_ONLY).length > 0 && !hits(t, NEW_LAYER).length;
  for (const r of riskHits) {
    if (contextOnly && ['realtime', 'auth', 'payments'].includes(r.id)) { reasons.push(`mentions ${r.id} as context only (${r.words[0]}) — not a stop by itself`); continue; }
    human += 2; reasons.push(`touches risk zone "${r.id}" (${r.words.slice(0, 2).join(', ')})`);
  }

  // 3. preset / base keyword heuristics
  const hh = hits(t, preset.triage.human); if (hh.length) { human += hh.length; reasons.push(`human-only keywords: ${hh.slice(0, 3).join(', ')}`); }
  const ah = hits(t, preset.triage.auto); if (ah.length) { auto += Math.min(ah.length, 3); reasons.push(`small-scope keywords: ${ah.slice(0, 3).join(', ')}`); }
  const nl = hits(t, NEW_LAYER); if (nl.length && riskHits.length) { human += 2; reasons.push(`introduces a new layer (${nl[0].trim()}) in a risk zone`); }
  const hasAc = hits(t, preset.triage.ac).length >= 2;
  if (hasAc) { auto += 1; reasons.push('has acceptance criteria'); } else reasons.push('no acceptance criteria (Given / When / Then) — add them before an automatic PR');
  if (t.length < 25) reasons.push('very short description — probably under-specified');

  let verdict;
  if (human >= 3 || (human >= 2 && auto === 0)) verdict = 'human';
  else if (!hasAc && auto < 3) verdict = 'needs-ac';
  else verdict = 'auto';
  if (verdict === 'auto' && human >= 2) verdict = 'needs-ac';

  return {
    verdict, score: { human, auto }, reasons, paths,
    domainDocs: zonesHit.map((z) => `docs/${z.dir.replace(/^(src|app|lib|pkg|internal|packages|apps)\//, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`),
    next: verdict === 'auto' ? 'Safe for an automatic PR — follow AGENTS.md.'
      : verdict === 'needs-ac' ? 'Ask for Given / When / Then criteria and an @path, then re-run triage.'
      : 'Human-only. The agent should stop and describe what is needed; do not open a PR.',
  };
}

function format(r) {
  const tag = { auto: 'AUTO  — safe for an automatic PR', 'needs-ac': 'NEEDS-AC — under-specified', human: 'HUMAN — outside the safe-list' }[r.verdict];
  const lines = [`\nagent-ready triage → ${tag}\n`, ...r.reasons.map((x) => `  - ${x}`)];
  if (r.domainDocs.length) lines.push(`  - read first: ${r.domainDocs.join(', ')}`);
  lines.push(`\n  Next: ${r.next}\n`);
  return lines.join('\n');
}

module.exports = { triage, format, RISK_WORDS };

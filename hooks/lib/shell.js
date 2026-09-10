'use strict';
// A small, quote-aware shell reader. Not a full parser — enough to know which command runs,
// what its arguments are, where its output goes, and to ignore text inside quotes and heredocs.
//
// parse("cd ../backend && echo x > f; cat 'sudo' | grep sudo") →
//   pipelines: [{ op: null, segments: [cmd(cd ../backend)] },
//               { op: '&&', segments: [cmd(echo x > f)] },
//               { op: ';',  segments: [cmd(cat 'sudo'), cmd(grep sudo)] }]
// where cmd = { text, masked, tokens, redirects, first, args }
//   masked   — quoted content replaced by "…" so rules never match prose ("fix sudo prompt")
//   tokens   — words with quotes removed (content kept), redirections extracted
//   redirects— [{ op: '>', target: 'f' }]  (targets to /dev/null and fd dups are dropped)

const PREFIX_WORDS = new Set(['command', 'exec', 'nohup', 'time', 'builtin', 'env', 'nice', 'ionice', 'stdbuf', 'unbuffer', 'caffeinate']);

function splitTop(cmd) {
  // Returns [{op, text}] splitting on operators outside quotes; heredoc bodies are removed.
  const out = [];
  let cur = '';
  let op = null;
  let q = null; // active quote char
  let i = 0;
  const s = String(cmd || '');
  const pendingHeredocs = [];
  while (i < s.length) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === '\\' && q === '"' && i + 1 < s.length) { cur += s[i + 1]; i += 2; continue; }
      if (c === q) q = null;
      i += 1; continue;
    }
    if (c === '\\' && i + 1 < s.length) { cur += c + s[i + 1]; i += 2; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; i += 1; continue; }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) { // comment to end of line
      while (i < s.length && s[i] !== '\n') i += 1;
      continue;
    }
    // heredoc introducer: remember the terminator, body is skipped after the line ends
    if (c === '<' && s[i + 1] === '<') {
      const m = s.slice(i).match(/^<<-?\s*(?:'([^']+)'|"([^"]+)"|(\\?\w+))/);
      if (m) { pendingHeredocs.push((m[1] || m[2] || m[3] || '').replace(/^\\/, '')); cur += m[0]; i += m[0].length; continue; }
    }
    if (c === '\n' && pendingHeredocs.length) {
      // skip body lines until each terminator
      let j = i + 1;
      while (pendingHeredocs.length && j < s.length) {
        const nl = s.indexOf('\n', j);
        const line = s.slice(j, nl === -1 ? s.length : nl);
        j = nl === -1 ? s.length : nl + 1;
        if (line.trim() === pendingHeredocs[0]) pendingHeredocs.shift();
      }
      out.push({ op, text: cur }); cur = ''; op = '\n'; i = j; continue;
    }
    const two = s.slice(i, i + 2);
    if (two === '&&' || two === '||') { out.push({ op, text: cur }); cur = ''; op = two; i += 2; continue; }
    if (two === '2>' || two === '&>' || two === '>>' || two === '>|' || two === '<(' || two === '>(') { cur += two; i += 2; continue; }
    if (c === ';' || c === '|' || c === '\n' || c === '&') {
      if (c === '&' && (s[i + 1] === '>' || s[i - 1] === '>' || s[i - 1] === '<')) { cur += c; i += 1; continue; }
      out.push({ op, text: cur }); cur = ''; op = c === '&' ? ';' : c; i += 1; continue;
    }
    cur += c; i += 1;
  }
  out.push({ op, text: cur });
  return out.map((p) => ({ op: p.op, text: p.text.trim() })).filter((p) => p.text);
}

// Split a single command into words; quotes removed, content kept. Also returns a masked string.
function words(text) {
  const tokens = [];
  let masked = '';
  let cur = '';
  let inWord = false;
  let q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === q) { q = null; masked += '…' + c; continue; }
      if (c === '\\' && q === '"' && i + 1 < text.length) { cur += text[i + 1]; i += 1; continue; }
      cur += c; continue;
    }
    if (c === '"' || c === "'") { q = c; inWord = true; masked += c; continue; }
    if (c === '\\' && i + 1 < text.length) { cur += text[i + 1]; masked += c + text[i + 1]; i += 1; inWord = true; continue; }
    if (/\s/.test(c)) { if (inWord) { tokens.push(cur); cur = ''; inWord = false; } masked += c; continue; }
    cur += c; masked += c; inWord = true;
  }
  if (inWord) tokens.push(cur);
  return { tokens, masked: masked.replace(/\s+/g, ' ').trim() };
}

function stripPrefixes(tokens, assigns) {
  let t = tokens.slice();
  let guard = 0;
  while (t.length && guard++ < 10) {
    const w = t[0];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { const [k, ...v] = w.split('='); if (assigns) assigns[k] = v.join('='); t.shift(); continue; }           // VAR=x
    if (/^[({!]$/.test(w)) { t.shift(); continue; }                              // ( { !
    if (w.startsWith('(') || w.startsWith('{')) { t[0] = w.replace(/^[({]+/, ''); if (!t[0]) { t.shift(); } continue; }
    if (w.startsWith('\\')) { t[0] = w.slice(1); break; }                          // \git
    if (PREFIX_WORDS.has(w)) { t.shift(); if (w === 'env' || w === 'nice' || w === 'ionice') while (t.length && /^-/.test(t[0])) t.shift(); continue; }
    break;
  }
  if (t.length && /[)}]$/.test(t[t.length - 1])) t[t.length - 1] = t[t.length - 1].replace(/[)}]+$/, '');
  return t.filter(Boolean);
}

function extractRedirects(tokens) {
  const args = [];
  const redirects = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const m = t.match(/^(\d*)(>>|>\||>|&>>|&>)(.*)$/);
    if (m && !/^\d+>&\d+$/.test(t)) {
      let target = m[3];
      if (!target && i + 1 < tokens.length) { target = tokens[i + 1]; i += 1; }
      if (target && !/^&\d+$/.test(target) && target !== '/dev/null' && target !== '/dev/stderr' && target !== '/dev/stdout') redirects.push({ op: m[2], target });
      continue;
    }
    if (/^\d*>&\d+$/.test(t) || t === '<') continue;
    if (t.startsWith('<') && t.length > 1 && !t.startsWith('<<')) continue; // input redirect
    args.push(t);
  }
  return { args, redirects };
}

const MASK_PREFIX = /^(?:[({!]\s*|[A-Za-z_][A-Za-z0-9_]*=\S*\s+|(?:command|exec|nohup|time|builtin|env|nice|ionice|stdbuf)\s+|\\)+/;
function command(text) {
  const { tokens, masked } = words(text);
  const assigns = {};
  const stripped = stripPrefixes(tokens, assigns);
  const { args, redirects } = extractRedirects(stripped);
  const cleanMasked = masked.replace(MASK_PREFIX, '').replace(/\s*[)}]+\s*$/, '').trim();
  return { text: text.trim(), masked: cleanMasked, tokens: stripped, args, redirects, first: args[0] || '', assigns };
}

function parse(cmd) {
  // splitTop already splits on single '|'; group consecutive '|' pieces into one pipeline.
  const pipelines = [];
  for (const piece of splitTop(cmd)) {
    const c = command(piece.text);
    if (piece.op === '|' && pipelines.length) { pipelines[pipelines.length - 1].segments.push(c); continue; }
    pipelines.push({ op: piece.op, segments: [c] });
  }
  for (const p of pipelines) { p.masked = p.segments.map((x) => x.masked).join(' | '); p.text = p.segments.map((x) => x.text).join(' | '); }
  return { pipelines, commands: pipelines.flatMap((p) => p.segments) };
}

module.exports = { parse, command, words, splitTop };

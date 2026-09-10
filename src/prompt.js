'use strict';
// Minimal interactive prompts on top of readline — no dependencies, works in any terminal.
// Interactive only when stdin is a TTY (or AGENT_READY_INTERACTIVE=1 for tests); otherwise every
// prompt returns its default so CI and scripts never hang.
const readline = require('readline');

function isInteractive() {
  if (process.env.AGENT_READY_INTERACTIVE === '1') return true;
  if (process.env.AGENT_READY_INTERACTIVE === '0' || process.env.CI) return false;
  return !!(process.stdin.isTTY && process.stdout.isTTY);
}

let rl = null;
const queue = [];
let waiting = null;
let closed = false;
// Lines that arrive before a question is asked (piped stdin) are buffered, not lost.
function iface() {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    rl.on('line', (l) => { if (waiting) { const w = waiting; waiting = null; w(l); } else queue.push(l); });
    rl.on('close', () => { closed = true; if (waiting) { const w = waiting; waiting = null; w(''); } });
  }
  return rl;
}
function close() { if (rl) { rl.close(); rl = null; } }

function question(text) {
  iface();
  process.stdout.write(text);
  return new Promise((resolve) => {
    if (queue.length) return resolve(queue.shift().trim());
    if (closed) return resolve('');
    waiting = (l) => resolve(l.trim());
  });
}

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

async function text(label, def) {
  if (!isInteractive()) return def;
  const a = await question(`${bold(label)} ${dim(`[${def}]`)}: `);
  return a || def;
}

async function confirm(label, def = true) {
  if (!isInteractive()) return def;
  const a = (await question(`${bold(label)} ${dim(def ? '[Y/n]' : '[y/N]')}: `)).toLowerCase();
  if (!a) return def;
  return a.startsWith('y');
}

// options: [{ id, label, hint }]
async function select(label, options, defId) {
  if (!isInteractive()) return defId;
  console.log(`\n${bold(label)}`);
  options.forEach((o, i) => console.log(`  ${i + 1}) ${o.label}${o.hint ? '  ' + dim(o.hint) : ''}${o.id === defId ? dim('  (default)') : ''}`));
  for (;;) {
    const a = await question(dim(`choose 1-${options.length}, Enter for default: `));
    if (!a) return defId;
    const n = parseInt(a, 10);
    if (n >= 1 && n <= options.length) return options[n - 1].id;
    const byId = options.find((o) => o.id === a);
    if (byId) return byId.id;
  }
}

async function multiselect(label, options, defIds) {
  if (!isInteractive()) return defIds;
  console.log(`\n${bold(label)}`);
  options.forEach((o, i) => console.log(`  ${defIds.includes(o.id) ? '[x]' : '[ ]'} ${i + 1}) ${o.label}${o.hint ? '  ' + dim(o.hint) : ''}`));
  for (;;) {
    const a = await question(dim('numbers separated by commas, "all", "none", or Enter for the marked ones: '));
    if (!a) return defIds;
    if (a === 'all') return options.map((o) => o.id);
    if (a === 'none') return [];
    const picked = a.split(/[\s,]+/).filter(Boolean).map((t) => { const n = parseInt(t, 10); return n >= 1 && n <= options.length ? options[n - 1].id : options.find((o) => o.id === t) && t; });
    if (picked.every(Boolean)) return [...new Set(picked)];
  }
}

module.exports = { isInteractive, text, confirm, select, multiselect, close, dim, bold };

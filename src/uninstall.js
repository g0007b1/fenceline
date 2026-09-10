'use strict';
// uninstall: the clean inverse of init. Removes everything namespaced (.agent-ready/, agent-ready-* rules
// and commands, our hook entries, our .gitignore lines). Docs are yours by then — kept unless --docs,
// which strips only the managed blocks.
const fs = require('fs');
const path = require('path');
const { adapters } = require('./adapters');
const R = require('./render');

function rmIf(p) { if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); return true; } return false; }

function uninstall(root, { docs = false } = {}) {
  const removed = [];
  if (rmIf(path.join(root, '.agent-ready'))) removed.push('.agent-ready/');
  for (const a of Object.values(adapters)) {
    const r = a.removeHooksConfig(root);
    if (r) removed.push(`${r.file} (${r.status})`);
    for (const dir of [a.rulesPath, a.commandsPath].filter(Boolean)) {
      const abs = path.join(root, dir);
      if (!fs.existsSync(abs)) continue;
      for (const f of fs.readdirSync(abs)) if (f.startsWith('agent-ready-')) { fs.unlinkSync(path.join(abs, f)); removed.push(`${dir}/${f}`); }
      if (!fs.readdirSync(abs).length) fs.rmdirSync(abs);
    }
  }
  const gi = path.join(root, '.gitignore');
  if (fs.existsSync(gi)) {
    const { GI_BEGIN, GI_END } = require('./init');
    const text = fs.readFileSync(gi, 'utf8');
    if (text.includes(GI_BEGIN) && text.includes(GI_END)) {
      const stripped = (text.slice(0, text.indexOf(GI_BEGIN)) + text.slice(text.indexOf(GI_END) + GI_END.length)).replace(/\n{3,}/g, '\n\n').replace(/^\n+$/, '');
      if (stripped.trim()) fs.writeFileSync(gi, stripped); else fs.unlinkSync(gi);
      removed.push('.gitignore entries');
    }
  }
  // drop directories we created that are now empty
  for (const dir of ['.claude/rules', '.claude/commands', '.cursor/rules', '.cursor/commands', 'docs/agent-rules', '.github/instructions', '.github/hooks', '.claude', '.cursor', '.codex', '.gemini']) {
    const abs = path.join(root, dir);
    try { if (fs.existsSync(abs) && fs.statSync(abs).isDirectory() && !fs.readdirSync(abs).length) fs.rmdirSync(abs); } catch { /* keep */ }
  }
  if (docs) {
    for (const f of ['AGENTS.md', 'CLAUDE.md', 'docs/agent-safe-tasks.md', 'docs/README.md']) {
      const abs = path.join(root, f);
      if (!fs.existsSync(abs)) continue;
      const text = fs.readFileSync(abs, 'utf8');
      if (!text.includes(R.BEGIN)) continue;
      const stripped = (text.slice(0, text.indexOf(R.BEGIN)) + text.slice(text.indexOf(R.END) + R.END.length)).replace(/<!-- Anything below[^\n]*\n?/, '').replace(/<!-- Add project-specific[^\n]*\n?/, '');
      if (stripped.replace(/^#[^\n]*\n/, '').trim() === '') { fs.unlinkSync(abs); removed.push(f); } else { fs.writeFileSync(abs, stripped); removed.push(`${f} (managed block stripped)`); }
    }
    for (const f of ['docs/handoffs/_TEMPLATE.md', 'docs/adr/_TEMPLATE.md']) if (rmIf(path.join(root, f))) removed.push(f);
    for (const dir of ['docs/handoffs', 'docs/adr', 'docs']) {
      const abs = path.join(root, dir);
      try { if (fs.existsSync(abs) && !fs.readdirSync(abs).length) fs.rmdirSync(abs); } catch { /* keep */ }
    }
  }
  return removed;
}

module.exports = { uninstall };

#!/usr/bin/env node
'use strict';
// beforeShellExecution / PreToolUse (Bash): the shell is the side door to every protected path,
// so this guard reasons about *what a command does*, not just what it looks like:
//   - every write target (redirects, cp/mv/tee/sed -i/… arguments, rm targets) is resolved against
//     a virtual cwd (cd chains honoured, $VAR expanded, symlinks resolved) and classified like an edit;
//   - git push is parsed (refspecs, force, mirror, delete) and checked against protected branches;
//   - destructive git / rm / find / chmod / privilege escalation are recognised by command, not by words
//     inside quotes — `git commit -m "fix sudo prompt"` is fine, `sudo rm -rf /` is not;
//   - interpreter one-liners (node -e, python -c, sh -c, eval) that mention a protected path are asked;
//   - reading secrets via cat/grep/source is asked;
//   - preset rules from config still apply to the masked command text.
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const P = require('./lib/protocol');
const { loadConfig } = require('./lib/state');
const { toRegExps, toShellRules, classify, isSecret, isTooling } = require('./lib/patterns');
const shell = require('./lib/shell');

const input = P.readStdin();
const runtime = P.detectRuntime(input);
if (!P.isShellTool(input)) P.allow();
const cmd = P.shellCommand(input) || '';
if (!cmd.trim()) P.allow();
const root = P.realRoot(P.projectRoot(input));
const cfg = loadConfig(root);
const meta = { root, tool: P.toolName(input), command: cmd.slice(0, 300) };
if (cfg.corrupt) P.deny(runtime, `agent-ready: ${cfg.corruptReason}. Refusing shell commands until the config is restored (fail-closed).`, 'PreToolUse', meta);

const ctx = { root, denyWrite: toRegExps(cfg.denyWrite), denyRead: toRegExps(cfg.denyRead || []), isInsideTmp: P.isInsideTmp };
const protectedBranches = new Set((cfg.protectedBranches || [cfg.baseBranch, 'main', 'master']).filter(Boolean));
const strict = { rmRecursive: 'ask', secretsRead: 'ask', inlineScripts: 'ask', gitCheckoutPaths: 'ask', ...(cfg.strictness || {}) };
// severity by knob: 'deny' → deny, 'ask' → ask, 'allow' → nothing
const byKnob = (knob, why, extra) => { if (strict[knob] === 'deny') deny(why, extra); if (strict[knob] === 'ask') ask(why, extra); };
const deny = (why, extra) => P.deny(runtime, `agent-ready: blocked \`${cmd.slice(0, 120)}\` — ${why}.`, 'PreToolUse', { ...meta, ...extra });
const ask = (why, extra) => P.ask(runtime, `agent-ready: \`${cmd.slice(0, 120)}\` — ${why}. Ask a human before running it.`, 'PreToolUse', { ...meta, ...extra });

const HOME = os.homedir();
const vars = { HOME, PWD: root, TMPDIR: os.tmpdir(), OLDPWD: root };
let vcwd = root;

function expand(tok) {
  let t = String(tok);
  t = t.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, k) => (vars[k] !== undefined ? vars[k] : process.env[k] !== undefined ? process.env[k] : m));
  if (t === '~' || t.startsWith('~/')) t = HOME + t.slice(1);
  return t;
}
function resolveIn(dir, tok) { const t = expand(tok); return P.realResolve(dir, path.isAbsolute(t) ? t : path.resolve(dir, t)); }
function relOf(abs) { return path.relative(root, abs).split(path.sep).join('/'); }
function looksLikePath(t) { return /[\/~]|^\.|\.[a-z0-9]{1,6}$/i.test(t) && !/^https?:\/\//.test(t) && !t.startsWith('-'); }
function checkWrite(tok, what) {
  const abs = resolveIn(vcwd, tok);
  const rel = relOf(abs);
  const hit = classify(cfg, rel, abs, ctx);
  if (hit) deny(`${what} "${rel}": ${hit.why}`, { path: rel, kind: hit.kind });
}
function currentBranch(dir) {
  try { return execSync('git symbolic-ref --short -q HEAD', { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 3000 }).trim() || null; } catch { return null; }
}
function untrackedSecrets(dir) {
  try {
    return execSync('git status --porcelain --untracked-files=all', { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 5000 })
      .split('\n').map((l) => l.slice(3).trim()).filter((f) => f && isSecret(ctx, f));
  } catch { return []; }
}
function flagsOf(args) { // -rf → ['r','f'], --recursive → ['recursive']
  const out = [];
  for (const a of args) { if (/^--/.test(a)) out.push(a.slice(2)); else if (/^-[A-Za-z]+$/.test(a)) out.push(...a.slice(1).split('')); }
  return out;
}
const nonFlags = (args) => args.filter((a) => !a.startsWith('-') && a !== '--');

const WRITE_LAST = new Set(['cp', 'mv', 'rsync', 'install', 'ln', 'scp']);
const WRITE_ALL = new Set(['tee', 'touch', 'mkdir', 'rmdir', 'truncate', 'chmod', 'chown', 'chgrp', 'unlink', 'shred', 'patch', 'xattr', 'setfacl']);
const READ_VERBS = new Set(['cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'awk', 'cut', 'sort', 'uniq', 'base64', 'xxd', 'od', 'strings', 'source', '.', 'wc', 'diff', 'bat', 'jq', 'yq', 'sed', 'perl', 'python', 'python3', 'node']);
const INTERP = new Set(['node', 'nodejs', 'deno', 'bun', 'python', 'python3', 'py', 'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'eval', 'perl', 'ruby', 'php', 'osascript', 'pwsh', 'powershell']);
const GIT_WRITE_SUBS = new Set(['add', 'commit', 'push', 'checkout', 'switch', 'reset', 'merge', 'rebase', 'stash', 'rm', 'mv', 'apply', 'cherry-pick', 'revert', 'tag', 'branch', 'clean', 'restore', 'am', 'pull', 'fetch', 'init', 'clone', 'worktree', 'submodule', 'filter-branch', 'update-ref', 'reflog', 'gc', 'prune', 'config']);

function gitCommand(seg) {
  const a = seg.args.slice(1);
  let dir = vcwd;
  let i = 0;
  for (; i < a.length; i++) {
    const t = a[i];
    if (t === '-c' || t === '--exec-path' || t === '--namespace') { i += 1; continue; }
    if (t === '-C') { dir = resolveIn(dir, a[i + 1] || '.'); i += 1; continue; }
    if (t.startsWith('-')) continue; // --no-pager, -p, --git-dir=…, --work-tree=…
    break;
  }
  const sub = a[i]; const rest = a.slice(i + 1);
  if (!sub) return;
  const inSibling = (cfg.siblings || []).some((s) => { const sr = path.resolve(root, s); return dir === sr || dir.startsWith(sr + path.sep); });
  if (inSibling && GIT_WRITE_SUBS.has(sub)) deny(`git ${sub} inside a read-only sibling repository`, { kind: 'sibling' });
  const flags = flagsOf(rest);
  switch (sub) {
    case 'push': {
      let force = false, lease = false, mirror = false, del = false;
      const positional = [];
      for (let j = 0; j < rest.length; j++) {
        const t = rest[j];
        if (t === '-f' || t === '--force' || t === '--force-with-lease=false' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(t)) force = true;
        else if (t.startsWith('--force-with-lease') || t === '--force-if-includes') lease = true;
        else if (t === '--mirror') mirror = true;
        else if (t === '-d' || t === '--delete') del = true;
        else if (t === '-o' || t === '--push-option' || t === '--receive-pack' || t === '--exec') j += 1;
        else if (t.startsWith('-')) continue;
        else positional.push(t);
      }
      if (mirror) deny('`git push --mirror` overwrites every branch on the remote');
      if (force) deny('force-push is irreversible');
      if (lease) ask('force-push with lease rewrites remote history');
      const refspecs = positional.slice(1);
      const dsts = [];
      if (!refspecs.length) dsts.push(currentBranch(dir) || '');
      for (const r0 of refspecs) {
        let r = r0;
        if (r.startsWith('+')) { r = r.slice(1); deny('`+refspec` is a force-push'); }
        const [src, dstRaw] = r.includes(':') ? r.split(':') : [r, r];
        let dst = (dstRaw || src).replace(/^refs\/heads\//, '');
        if (dst === 'HEAD' || (dst === src && src === 'HEAD') || dst === '') dst = currentBranch(dir) || '';
        dsts.push(dst);
      }
      for (const dst of dsts) {
        if (dst && protectedBranches.has(dst)) {
          if (del) deny(`deleting protected branch ${dst}`);
          deny(`direct push to protected branch ${dst} — open a PR instead`, { branch: dst });
        }
      }
      if (del) ask('deleting a remote branch');
      return;
    }
    case 'reset': if (rest.includes('--hard')) deny('`git reset --hard` destroys uncommitted work'); return;
    case 'checkout':
      if (flags.some((f) => f === 'b' || f === 'B' || f === 'orphan')) return;
      if (rest.includes('.') || rest.includes('--') || rest.some((t) => t === '-f' || t === '--force')) byKnob('gitCheckoutPaths', '`git checkout` on paths discards working-tree changes');
      return;
    case 'restore':
      if (rest.includes('--staged') && !rest.includes('--worktree') && !rest.includes('-W')) return;
      byKnob('gitCheckoutPaths', '`git restore` discards working-tree changes');
      return;
    case 'clean': if (flags.includes('f') || flags.includes('force')) deny('`git clean -f` deletes untracked files'); return;
    case 'branch': {
      const forceDel = flags.includes('D') || ((flags.includes('d') || flags.includes('delete')) && (flags.includes('f') || flags.includes('force')));
      const names = nonFlags(rest);
      if (names.some((n) => protectedBranches.has(n)) && (flags.includes('d') || flags.includes('D') || flags.includes('delete') || flags.includes('m') || flags.includes('M'))) deny('renaming or deleting a protected branch');
      if (forceDel) ask('force-deleting a branch');
      return;
    }
    case 'stash': if (rest[0] === 'drop' || rest[0] === 'clear') deny('drops stashed work'); return;
    case 'filter-branch': case 'filter-repo': deny('history rewrite');
    // eslint-disable-next-line no-fallthrough
    case 'update-ref': if (flags.includes('d') || flags.includes('delete')) deny('deleting a ref by hand'); return;
    case 'reflog': if (rest[0] === 'expire' || rest[0] === 'delete') deny('expiring the reflog destroys recovery points'); return;
    case 'gc': if (rest.some((t) => t.startsWith('--prune'))) ask('pruning unreachable objects'); return;
    case 'add': case 'commit': case 'rm': case 'mv': {
      const paths = nonFlags(rest).filter((t) => t !== 'add' && t !== 'commit');
      for (const p of paths) { const rel = relOf(resolveIn(dir, p)); if (isSecret(ctx, rel)) deny(`\`git ${sub} ${p}\` would commit a secrets file`, { path: rel, kind: 'secret' }); }
      if (sub === 'add' && (rest.includes('-A') || rest.includes('--all') || rest.includes('.') || rest.includes(':/') || rest.includes('-u'))) {
        const secrets = untrackedSecrets(dir);
        if (secrets.length) deny(`\`git add\` would stage secrets: ${secrets.slice(0, 3).join(', ')} — add them to .gitignore first`, { kind: 'secret' });
      }
      if (sub === 'commit' && (rest.includes('-a') || rest.includes('--all') || /^-[a-zA-Z]*a/.test(rest[0] || ''))) {
        const secrets = untrackedSecrets(dir).filter(Boolean);
        if (secrets.length) deny(`\`git commit -a\` would commit secrets: ${secrets.slice(0, 3).join(', ')}`, { kind: 'secret' });
      }
      if (sub === 'rm' && (flags.includes('r') || flags.includes('R'))) ask('recursive `git rm`');
      return;
    }
    default: return;
  }
}

function rmCommand(seg) {
  const a = seg.args.slice(1);
  const flags = flagsOf(a);
  const recursive = flags.includes('r') || flags.includes('R') || flags.includes('recursive');
  const targets = nonFlags(a);
  for (const t of targets) {
    const e = expand(t);
    const bare = e.replace(/\/+$/, '');
    const abs = resolveIn(vcwd, e.replace(/[*?].*$/, '') || '.');
    const dangerous = bare === '/' || bare === '~' || bare === HOME || bare === '..' || bare === '.' || bare === '*' || bare === './*' || bare === '/*' || bare === '.*'
      || abs === root || abs === path.dirname(root) || abs === HOME || abs === path.parse(abs).root
      || (/[*?]/.test(e) && path.dirname(path.resolve(vcwd, e)) === root && recursive);
    if (dangerous && recursive) deny('recursive delete of the repository, home or filesystem root');
    if (dangerous) ask('deleting at the repository root');
    checkWrite(e.replace(/[*?].*$/, '') || '.', 'deleting');
  }
  if (recursive) byKnob('rmRecursive', 'recursive delete');
}

// ---------- walk the command ----------
const parsed = shell.parse(cmd);
for (const pipeline of parsed.pipelines) {
  // curl … | sh
  for (let i = 0; i < pipeline.segments.length - 1; i++) {
    const a = pipeline.segments[i].first, b = pipeline.segments[i + 1].first;
    if (/^(curl|wget|fetch)$/.test(a) && /^(sh|bash|zsh|dash|ksh|fish|python3?|node|perl|ruby)$/.test(b)) deny('piping a downloaded script into an interpreter');
  }
  for (const seg of pipeline.segments) {
    Object.assign(vars, seg.assigns);
    const first = seg.first;
    if (!first) continue;
    const args = seg.args.slice(1);

    if (first === 'cd' || first === 'pushd') { const target = nonFlags(args)[0]; vcwd = !target || target === '-' ? root : resolveIn(vcwd, target); vars.PWD = vcwd; continue; }
    if (first === 'popd') { vcwd = root; continue; }
    if (/^(sudo|doas|su|pkexec|runas)$/.test(first)) deny('no privilege escalation');
    if (/^(shutdown|reboot|halt|poweroff|mkfs(\.\w+)?|fdisk|diskutil)$/.test(first)) deny('destructive system command');
    if (first === 'dd' && args.some((t) => /^of=\/dev\//.test(t))) deny('writing to a raw device');
    if (first === ':()' || seg.masked.startsWith(':(){')) deny('fork bomb');
    if (first === 'chmod' && args.some((t) => /^(-R\s*)?(0?777|a\+rwx|o\+w|ugo\+rwx|a=rwx)$/.test(t))) deny('world-writable permissions');
    if (first === 'kill' && args.includes('-1')) deny('killing every process');
    if (/^(psql|mysql|mariadb|mongosh?|sqlite3|redis-cli|clickhouse-client|cqlsh)$/.test(first) && /\b(drop\s+(table|database|schema)|truncate|delete\s+from|flushall|flushdb|deleteMany|dropDatabase)\b/i.test(seg.text)) deny('destructive database statement');

    // redirects are writes
    for (const r of seg.redirects) checkWrite(r.target, 'writing');

    if (first === 'rm') { rmCommand(seg); continue; }
    if (first === 'git') { gitCommand(seg); continue; }
    if (first === 'find') {
      if (args.includes('-delete') || (args.includes('-exec') && args.some((t) => /^(rm|mv|sed|chmod)$/.test(t)))) ask('`find` with a destructive action');
      continue;
    }
    if (WRITE_LAST.has(first)) { const nf = nonFlags(args); if (nf.length) checkWrite(nf[nf.length - 1], `${first} into`); if (first === 'ln') for (const t of nf) checkWrite(t, 'linking'); continue; }
    if (WRITE_ALL.has(first)) { for (const t of nonFlags(args)) checkWrite(t, `${first} on`); continue; }
    if ((first === 'sed' || first === 'perl') && args.some((t) => /^-[a-zA-Z]*i/.test(t) || t === '--in-place')) {
      const nf = nonFlags(args); for (const t of nf.slice(first === 'sed' && !args.some((x) => x === '-e' || x === '--expression') ? 1 : 0)) if (looksLikePath(t)) checkWrite(t, 'in-place edit of');
      continue;
    }
    // interpreter one-liners: inspect the whole segment text for protected paths
    const inline = first === 'eval' || (INTERP.has(first) && args.some((t) => /^(-e|-c|--eval|-r|-p|--print|-Command|-c\w*)$/.test(t) || /^-[a-zA-Z]*[ec][a-zA-Z]*$/.test(t)));
    if (inline) {
      const mentions = [...new Set(seg.text.match(/[\w./~$-]+/g) || [])].filter((t) => looksLikePath(t) && !/^-/.test(t));
      for (const m of mentions) {
        const abs = resolveIn(vcwd, m); const rel = relOf(abs);
        const hit = classify(cfg, rel, abs, ctx);
        if (hit) byKnob('inlineScripts', `inline ${first} script mentions ${hit.kind} path "${rel}" — do file edits through the edit tool so they can be checked`, { path: rel, kind: hit.kind });
        if (isSecret(ctx, rel)) byKnob('secretsRead', `inline ${first} script reads secrets file "${rel}"`, { path: rel, kind: 'secret-read' });
      }
      if (/\b(child_process|subprocess|os\.system|execSync|spawn|shell=True)\b/.test(seg.text) && /\b(git\s+push|rm\s+-r|--force|reset\s+--hard)\b/.test(seg.text)) byKnob('inlineScripts', 'inline script runs a guarded shell command');
      continue;
    }
    // reading secrets
    if (READ_VERBS.has(first)) {
      for (const t of nonFlags(args)) { if (!looksLikePath(t)) continue; const rel = relOf(resolveIn(vcwd, t)); if (isSecret(ctx, rel)) byKnob('secretsRead', `reading secrets file "${rel}" into the agent context`, { path: rel, kind: 'secret-read' }); }
    }
    if (first === 'export' && /\$\(\s*(cat|grep)\b[^)]*\.env\b/.test(seg.text)) byKnob('secretsRead', 'exporting secrets from .env into the environment');
    // anything with vcwd inside a sibling and a write verb was caught above; generic tools running inside a sibling:
    if (/^(npm|pnpm|yarn|bun|pip|uv|poetry|cargo|go|make)$/.test(first) && args.some((t) => /^(install|add|remove|uninstall|update|upgrade|publish|link|init|new|generate|migrate|deploy)$/.test(t))) {
      const inSibling = (cfg.siblings || []).some((s) => { const sr = path.resolve(root, s); return vcwd === sr || vcwd.startsWith(sr + path.sep); });
      if (inSibling) deny('package manager write inside a read-only sibling repository', { kind: 'sibling' });
    }
    if (looksLikePath(first) && /\.sh$|\.bash$/.test(first)) { /* running a local script is fine */ }
  }
  // preset rules against the masked pipeline and each masked segment (never against quoted text)
  for (const rule of toShellRules(cfg.denyShell)) {
    const hit = rule.re.test(pipeline.masked) ? pipeline.masked : (pipeline.segments.find((s) => rule.re.test(s.masked)) || {}).masked;
    if (!hit) continue;
    if (rule.severity === 'ask') ask(rule.why, { rule: rule.re.source });
    deny(rule.why, { rule: rule.re.source });
  }
}
// tooling mentioned anywhere with a redirect/write verb slipped through? belt and braces:
for (const seg of parsed.commands) {
  if (!/^(cat|less|more|head|tail|grep|rg|ls|find|git|node|cd|echo|printf|test|\[|diff|stat|file|tree|wc|jq)$/.test(seg.first)) {
    for (const t of seg.args.slice(1)) { const rel = relOf(resolveIn(vcwd, t)); if (looksLikePath(t) && isTooling(rel)) deny(`\`${seg.first}\` touches the agent-ready hook machinery (${rel})`, { path: rel, kind: 'tooling' }); }
  }
}
P.allow();

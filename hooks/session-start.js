#!/usr/bin/env node
'use strict';
// sessionStart / SessionStart: inject the non-negotiables so nobody has to paste context by hand.
// State is reset only for a genuinely new session — not on compaction or resume, which would
// forget the edits made so far and release the agent without checks.
const P = require('./lib/protocol');
const S = require('./lib/state');
const fs = require('fs');
const path = require('path');

const input = P.readStdin();
const runtime = P.detectRuntime(input);
// Cursor: only the Agent mode runs tools.
if (input.composer_mode && input.composer_mode !== 'agent') P.done();
const root = P.realRoot(P.projectRoot(input));
const cfg = S.loadConfig(root);
const session = P.sessionId(input);
S.gc(root);
const source = String(input.source || '').toLowerCase();
if (!source || source === 'startup' || source === 'clear' || source === 'new') S.reset(root, session);

const checks = (cfg.checks || []).map((c) => c.command);
const lines = [
  'agent-ready gates for this repository:',
  checks.length
    ? `- Before finishing any code change run: ${checks.join(' && ')} — the stop-hook runs them itself and will not let you finish otherwise.`
    : '- No lint / type-check commands are configured yet; say so in your answer if you change code.',
  '- Protected paths, secrets, sibling repos and the hook config are enforced by hooks (writes are denied): see AGENTS.md "Hard bans".',
  (cfg.siblings || []).length ? `- Sibling repositories (${cfg.siblings.join(', ')}) are read-only. Mismatches go to docs/handoffs/.` : null,
  cfg.corrupt ? `- WARNING: ${cfg.corruptReason} — every edit and shell command is denied until it is fixed.` : null,
  '- Tasks outside docs/agent-safe-tasks.md: stop, explain the risk in 2–3 sentences, do not open a PR.',
  '- Before touching a fragile zone, read its domain doc in docs/ (index: docs/README.md).',
  '- Keep scope narrow: no "while I am here" refactors.',
  '- End every task with a "How to test" section.',
].filter(Boolean);
if (fs.existsSync(path.join(root, 'AGENTS.md'))) lines.push('- Operating manual: AGENTS.md (read it once per session).');
P.context(runtime, lines.join('\n'));

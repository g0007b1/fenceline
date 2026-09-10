'use strict';
// Strictness profiles: one word that sets a coherent bundle of knobs. Every knob is still
// individually editable in .fenceline/config.json (`fenceline config set …`).

const PROFILES = {
  strict: {
    label: 'Strict',
    hint: 'stop hook re-runs every check even when the agent reported green; tests required; rm -r and secret reads denied',
    config: {
      runChecksOnStop: 'always', maxStopAttempts: 6, requireTests: true,
      gates: { review: true, docsSync: true },
      strictness: { rmRecursive: 'deny', secretsRead: 'deny', inlineScripts: 'deny', gitCheckoutPaths: 'deny' },
    },
  },
  balanced: {
    label: 'Balanced',
    hint: 'checks re-run only when not honestly green; review + docs-sync gates on; risky-but-common commands ask',
    config: {
      runChecksOnStop: 'missing', maxStopAttempts: 4, requireTests: false,
      gates: { review: true, docsSync: true },
      strictness: { rmRecursive: 'ask', secretsRead: 'ask', inlineScripts: 'ask', gitCheckoutPaths: 'ask' },
    },
  },
  light: {
    label: 'Light',
    hint: 'guards for secrets, git and the hook machinery; checks must pass; no review / docs-sync nudges; rm -r allowed',
    config: {
      runChecksOnStop: 'missing', maxStopAttempts: 2, requireTests: false,
      gates: { review: false, docsSync: false },
      strictness: { rmRecursive: 'allow', secretsRead: 'ask', inlineScripts: 'ask', gitCheckoutPaths: 'ask' },
    },
  },
};

// Everything init can install. Order matters for display.
const COMPONENTS = [
  { id: 'hooks', label: 'Hooks', hint: 'guards + stop gate, wired into each runtime — the enforcement', default: true },
  { id: 'rules', label: 'Rules', hint: 'code conventions in the runtime\'s rules format (.mdc / path-scoped .md / instructions.md)', default: true },
  { id: 'commands', label: 'Slash commands', hint: '/fenceline-review, -pr, -handoff, -domain-doc, -triage (Cursor, Claude Code)', default: true },
  { id: 'docs', label: 'Layered docs', hint: 'AGENTS.md, CLAUDE.md, docs/agent-safe-tasks.md, docs/README.md (managed blocks)', default: true },
  { id: 'domain-docs', label: 'Domain docs', hint: 'one skeleton per fragile zone found in git history', default: true },
  { id: 'templates', label: 'Templates', hint: 'docs/handoffs/_TEMPLATE.md, docs/adr/_TEMPLATE.md', default: true },
  { id: 'skill', label: 'Skill', hint: 'copy the fenceline skill so an agent can finish the setup', default: false },
];

function getProfile(id) {
  if (!PROFILES[id]) throw new Error(`Unknown profile "${id}". Known: ${Object.keys(PROFILES).join(', ')}`);
  return PROFILES[id];
}

module.exports = { PROFILES, COMPONENTS, getProfile };

'use strict';
module.exports = {
  id: 'node',
  label: 'Node.js library / CLI',
  description: 'Plain Node.js or TypeScript package without a web or API framework.',
  rules: ['node-package.mdc'],
  denyShell: [
    { re: /^(npm|pnpm|yarn)\s+version\s+(major|minor|patch|pre)/, why: 'version bumps are part of a release — human-only', severity: 'ask' },
  ],
  safeHuman: ['Publishing a release, bumping the package version, changing the public API surface'],
  triage: { human: ['publish', 'public api', 'breaking'] },
  doctor: { allowPaths: ['src/index.ts'], denyShell: ['npm publish'], askShell: ['npm version patch'] },
};

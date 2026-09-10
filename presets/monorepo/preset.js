'use strict';
module.exports = {
  id: 'monorepo',
  label: 'Monorepo',
  description: 'Workspaces (pnpm / yarn / npm / turbo / nx / go.work / cargo workspace): one package per automatic PR, shared packages are human-reviewed.',
  rules: ['monorepo-boundaries.mdc'],
  integrationTriggers: [/^pnpm-workspace\.yaml$/, /^turbo\.json$/, /^nx\.json$/, /^lerna\.json$/, /^go\.work$/],
  safeHuman: [
    'Changes that cross package boundaries (two or more packages in one PR)',
    'Shared packages consumed by more than one app',
    'Workspace configuration, build graph, version bumps',
  ],
  triage: { human: ['shared package', 'workspace', 'cross-package', 'all packages', 'общий пакет', 'все пакеты'] },
  doctor: { allowPaths: ['packages/ui/src/Button.tsx'] },
};

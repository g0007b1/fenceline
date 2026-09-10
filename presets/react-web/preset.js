'use strict';
module.exports = {
  id: 'react-web',
  label: 'React / Next.js / Vite web app',
  description: 'Component-based web front-ends: component structure, state placement, theme discipline.',
  rules: ['react-components.mdc'],
  safeAuto: [
    'A small state or type change with a written spec',
    'Storybook stories for existing components',
    'Accessibility fixes (labels, roles, focus order) on existing components',
  ],
  safeHuman: [
    'Authentication, session handling, payments, anything touching PII',
    'Routing architecture changes, new global state, build configuration',
    'Analytics / tracking changes that affect what is sent to third parties',
  ],
  triage: { human: ['routing', 'global state', 'analytics', 'tracking', 'pii', 'gdpr', 'роутинг', 'аналитик'] },
  doctor: { allowPaths: ['src/components/Button/Button.tsx'] },
};

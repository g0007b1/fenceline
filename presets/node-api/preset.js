'use strict';
module.exports = {
  id: 'node-api',
  label: 'Node.js API',
  description: 'Express / Fastify / NestJS / Koa / Hono services: migrations and schema are human-only, destructive DB commands are blocked.',
  rules: ['backend-modules.mdc'],
  safeAuto: [
    'A new validation rule or error message inside an existing endpoint, with a test',
    'A read-only endpoint over existing data, with a spec and a test',
    'Logging / observability improvements that do not change behaviour',
  ],
  safeHuman: [
    'Auth, permissions, payments, anything that moves money or data across users',
    'Changes to public API contracts consumed by other services (write a handoff instead)',
    'Background jobs, queues, retries — anything with at-least-once semantics',
  ],
  triage: { human: ['migration', 'schema', 'endpoint contract', 'breaking', 'queue', 'cron', 'permission', 'role', 'миграц', 'схем', 'контракт', 'очеред', 'роль', 'права'] },
  doctor: { allowPaths: ['src/routes/users.ts'] },
};

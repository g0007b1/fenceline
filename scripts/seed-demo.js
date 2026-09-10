#!/usr/bin/env node
'use strict';
// Creates ./demo-app — a small Next.js + Prisma + Stripe repo with a "fixy" git history — so
// `vhs assets/demo.tape` and README screenshots are reproducible. Safe to re-run.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(process.argv[2] || 'demo-app');
fs.rmSync(root, { recursive: true, force: true });
const w = (rel, content) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), content); };
const git = (c) => execSync(`git ${c}`, { cwd: root, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@example.com', GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@example.com' } });

w('package.json', JSON.stringify({
  name: 'bookings-web', private: true,
  scripts: { lint: 'eslint .', 'type-check': 'tsc --noEmit', test: 'vitest run' },
  dependencies: { next: '15', react: '19', '@tanstack/react-query': '5', '@prisma/client': '6', stripe: '17', 'next-auth': '5' },
  devDependencies: { typescript: '5', eslint: '9', vitest: '3', prisma: '6' },
}, null, 2) + '\n');
w('prisma/schema.prisma', 'model Booking {\n  id Int @id\n}\n');
w('.github/workflows/ci.yml', 'name: ci\non: [pull_request]\n');
w('.env.example', 'DATABASE_URL=\nSTRIPE_SECRET_KEY=\n');
w('src/features/bookings/slots.ts', 'export const slots = () => [];\n');
w('src/features/payments/pay.ts', 'export const pay = () => 1;\n');
w('src/components/Header/Header.tsx', 'export const Header = () => null;\n');
w('README.md', '# bookings-web\n');

git('init -q');
git('add -A'); git('commit -qm "init"');
for (let i = 1; i <= 12; i++) { fs.appendFileSync(path.join(root, 'src/features/bookings/slots.ts'), `// ${i}\n`); git(`commit -qam "fix: overlapping slots case ${i}"`); }
for (let i = 1; i <= 3; i++) { fs.appendFileSync(path.join(root, 'src/features/payments/pay.ts'), `// ${i}\n`); git(`commit -qam "feat: payments ${i}"`); }
console.log(`demo repo ready at ${root}`);

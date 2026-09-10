'use strict';
const path = require('path');
const { exists, readJson, stack } = require('./util');

function detect(root) {
  const pkg = readJson(root, 'package.json');
  if (!pkg) return null;
  const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies, pkg.peerDependencies);
  const has = (n) => Object.prototype.hasOwnProperty.call(deps, n);
  const scripts = pkg.scripts || {};
  const pm = exists(root, 'pnpm-lock.yaml') ? 'pnpm'
    : exists(root, 'yarn.lock') ? 'yarn'
    : (exists(root, 'bun.lockb') || exists(root, 'bun.lock')) ? 'bun'
    : 'npm';
  const run = (s) => `${pm} run ${s}`;
  const script = (...names) => names.find((n) => scripts[n] && !/no test specified/.test(scripts[n])) || null;

  const typescript = has('typescript') || exists(root, 'tsconfig.json');
  const f = {
    react: has('react'), reactNative: has('react-native'), expo: has('expo'),
    expoManaged: has('expo') && !exists(root, 'ios') && !exists(root, 'android'),
    next: has('next'), vite: has('vite'), remix: has('@remix-run/react'), nuxt: has('nuxt'), vue: has('vue'), svelte: has('svelte'), angular: has('@angular/core'),
    express: has('express'), fastify: has('fastify'), koa: has('koa'), nest: has('@nestjs/core'), hono: has('hono'),
    redux: has('@reduxjs/toolkit'), tanstackQuery: has('@tanstack/react-query'), zustand: has('zustand'),
    prisma: has('prisma') || has('@prisma/client'), knex: has('knex'), drizzle: has('drizzle-orm'), typeorm: has('typeorm'), mongoose: has('mongoose'), sequelize: has('sequelize'),
    jest: has('jest'), vitest: has('vitest'), playwright: has('@playwright/test'), cypress: has('cypress'), detox: has('detox'),
    eslint: has('eslint'), biome: has('@biomejs/biome'), prettier: has('prettier'),
    storybook: Object.keys(deps).some((d) => d.startsWith('@storybook/')),
    electron: has('electron'), tauri: has('@tauri-apps/api'),
  };
  f.server = !!(f.express || f.fastify || f.koa || f.nest || f.hono);
  const monorepo = !!pkg.workspaces || exists(root, 'pnpm-workspace.yaml') || exists(root, 'turbo.json') || exists(root, 'nx.json') || exists(root, 'lerna.json');

  const lint = script('lint', 'lint:check', 'eslint');
  const typeCheck = script('type-check', 'typecheck', 'tsc', 'check-types', 'types');
  const test = script('test', 'test:unit');
  const build = script('build');

  const suggestions = [];
  if (!lint && (f.eslint || f.biome)) suggestions.push(`Add a lint script: "lint": "${f.biome ? 'biome check .' : 'eslint .'}"`);
  if (!typeCheck && typescript) suggestions.push('Add "type-check": "tsc --noEmit" to package.json — without it the stop-hook cannot enforce types.');

  const summary = [];
  if (f.expo) summary.push('Expo'); else if (f.reactNative) summary.push('React Native');
  if (f.next) summary.push('Next.js'); else if (f.remix) summary.push('Remix'); else if (f.react) summary.push('React');
  if (f.nuxt) summary.push('Nuxt'); else if (f.vue) summary.push('Vue');
  if (f.svelte) summary.push('Svelte'); if (f.angular) summary.push('Angular');
  if (f.vite) summary.push('Vite');
  summary.push(typescript ? 'TypeScript' : 'JavaScript');
  for (const [k, label] of [['nest', 'NestJS'], ['fastify', 'Fastify'], ['express', 'Express'], ['koa', 'Koa'], ['hono', 'Hono']]) if (f[k]) summary.push(label);
  if (f.redux) summary.push('Redux Toolkit'); if (f.tanstackQuery) summary.push('TanStack Query'); if (f.zustand) summary.push('Zustand');
  for (const [k, label] of [['prisma', 'Prisma'], ['knex', 'Knex'], ['drizzle', 'Drizzle'], ['typeorm', 'TypeORM'], ['mongoose', 'Mongoose'], ['sequelize', 'Sequelize']]) if (f[k]) summary.push(label);
  for (const [k, label] of [['jest', 'Jest'], ['vitest', 'Vitest'], ['playwright', 'Playwright'], ['cypress', 'Cypress'], ['detox', 'Detox']]) if (f[k]) summary.push(label);
  if (f.eslint) summary.push('ESLint'); if (f.biome) summary.push('Biome');
  if (monorepo) summary.push('monorepo');
  summary.push(pm);

  return stack({
    ecosystem: 'node',
    name: pkg.name || path.basename(root),
    language: typescript ? 'typescript' : 'javascript',
    packageManager: pm,
    typescript,
    monorepo,
    depNames: Object.keys(deps).map((d) => d.toLowerCase()),
    frameworks: f,
    checks: { lint: lint && run(lint), typeCheck: typeCheck && run(typeCheck), test: test && run(test), build: build && run(build) },
    suggestions,
    summary,
  });
}

module.exports = { id: 'node', detect };

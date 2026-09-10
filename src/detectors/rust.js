'use strict';
const path = require('path');
const { exists, read, stack } = require('./util');

function detect(root) {
  if (!exists(root, 'Cargo.toml')) return null;
  const cargo = read(root, 'Cargo.toml');
  const name = (cargo.match(/^\s*name\s*=\s*["']([^"']+)["']/m) || [])[1] || path.basename(root);
  const depNames = [];
  for (const m of cargo.matchAll(/\[(?:workspace\.)?(?:dev-|build-)?dependencies\]([\s\S]*?)(?=\n\[|$)/g)) {
    m[1].split('\n').forEach((l) => { const k = l.split('=')[0].trim(); if (k && !k.startsWith('#')) depNames.push(k.toLowerCase()); });
  }
  const f = {
    axum: depNames.includes('axum'), actix: depNames.includes('actix-web'), rocket: depNames.includes('rocket'), tokio: depNames.includes('tokio'),
    sqlx: depNames.includes('sqlx'), diesel: depNames.includes('diesel'), seaorm: depNames.includes('sea-orm'), serde: depNames.includes('serde'), tauri: depNames.includes('tauri'),
  };
  const monorepo = /\[workspace\]/.test(cargo);
  const summary = ['Rust'];
  for (const [k, label] of [['axum', 'Axum'], ['actix', 'Actix'], ['rocket', 'Rocket'], ['tokio', 'Tokio'], ['sqlx', 'sqlx'], ['diesel', 'Diesel'], ['seaorm', 'SeaORM'], ['tauri', 'Tauri']]) if (f[k]) summary.push(label);
  if (monorepo) summary.push('cargo workspace');
  summary.push('cargo');
  return stack({ ecosystem: 'rust', name, language: 'rust', packageManager: 'cargo', depNames, frameworks: f, monorepo,
    checks: { lint: 'cargo clippy --all-targets -- -D warnings', typeCheck: 'cargo check --all-targets', test: 'cargo test', build: 'cargo build' },
    suggestions: [], summary });
}

module.exports = { id: 'rust', detect };

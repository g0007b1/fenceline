'use strict';
module.exports = {
  id: 'rust',
  label: 'Rust',
  description: 'Rust crates and services: clippy / check / test are the gates, unsafe and migrations are human-only.',
  denyWrite: [{ re: /^Cargo\.lock$/, label: 'Cargo.lock (use cargo add / cargo update -p)' }],
  denyShell: [
    { re: /^cargo\s+publish\b/, why: 'publishing to crates.io is human-only' },
    { re: /^cargo\s+update\s*$|^cargo\s+update\s+(?!.*-p\s)/, why: 'bulk dependency upgrade — human-only', severity: 'ask' },
  ],
  rules: ['rust-conventions.mdc'],
  hardBans: ['`unsafe` blocks are human-only. `Cargo.lock` is updated only through `cargo add` / targeted `cargo update -p`.'],
  safeAuto: ['A pure function with a `#[cfg(test)]` unit test', 'A new error variant and its message, with a test'],
  safeHuman: ['Anything containing `unsafe`', 'Public crate API changes (breaking for downstream users)', 'Async runtime / concurrency model changes'],
  triage: { human: ['unsafe', 'migration', 'public api', 'breaking', 'runtime', 'миграц'] },
  doctor: { allowPaths: ['src/pricing.rs'], denyShell: ['cargo publish'], askShell: ['cargo update'], allowShell: ['cargo test', 'cargo update -p serde'] },
};

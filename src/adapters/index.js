'use strict';
const cursor = require('./cursor');
const claude = require('./claude');
const codex = require('./codex');
const gemini = require('./gemini');
const copilot = require('./copilot');
const adapters = { cursor, claude, codex, gemini, copilot };

function getAdapters(names) {
  return names.map((n) => {
    if (!adapters[n]) throw new Error(`Unknown runtime "${n}". Known: ${Object.keys(adapters).join(', ')}`);
    return adapters[n];
  });
}

module.exports = { adapters, getAdapters, RUNTIME_IDS: Object.keys(adapters) };

'use strict';
// Minimal template rendering + managed-block merging.
// Managed blocks are delimited by <!-- agent-ready:managed:begin/end -->.
// On refresh we replace only the managed block and keep everything the humans wrote around it.

const fs = require('fs');
const path = require('path');

const BEGIN = '<!-- agent-ready:managed:begin -->';
const END = '<!-- agent-ready:managed:end -->';

function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] == null ? '' : String(vars[key])));
}

function loadTemplate(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'templates', name), 'utf8').replace(/\r\n/g, '\n');
}

// Write file; if it exists and has markers, replace only the managed block.
// If it exists without markers, leave it alone and return 'skipped' (never clobber human docs).
function writeManaged(target, content, { force = false, dry = false } = {}) {
  if (!fs.existsSync(target)) {
    if (!dry) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); }
    return 'created';
  }
  const existing = fs.readFileSync(target, 'utf8');
  const hasMarkers = existing.includes(BEGIN) && existing.includes(END);
  const begins = existing.split(BEGIN).length - 1, ends = existing.split(END).length - 1;
  if (hasMarkers && (begins !== 1 || ends !== 1 || existing.indexOf(END) < existing.indexOf(BEGIN))) {
    throw new Error(`${target}: expected exactly one managed block (begin before end); found ${begins} begin / ${ends} end markers. Fix the markers by hand.`);
  }
  if (!hasMarkers) {
    if (!force) return 'skipped';
    if (!dry) fs.writeFileSync(target, content);
    return 'overwritten';
  }
  const newBlock = content.slice(content.indexOf(BEGIN), content.indexOf(END) + END.length);
  const merged = existing.slice(0, existing.indexOf(BEGIN)) + newBlock + existing.slice(existing.indexOf(END) + END.length);
  if (merged === existing) return 'unchanged';
  if (!dry) fs.writeFileSync(target, merged);
  return 'updated';
}

function writeIfMissing(target, content, { dry = false } = {}) {
  if (fs.existsSync(target)) return 'skipped';
  if (!dry) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); }
  return 'created';
}

module.exports = { render, loadTemplate, writeManaged, writeIfMissing, BEGIN, END };

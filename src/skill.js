'use strict';
// skill: copy the agent-ready skill into a skills directory the agent runtime reads,
// so "finish the setup with the agent-ready skill" works from a fresh session.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'skill', 'agent-ready');

function defaultTarget(root) {
  if (fs.existsSync(path.join(root, '.agents'))) return path.join(root, '.agents', 'skills', 'agent-ready');
  if (fs.existsSync(path.join(root, '.claude'))) return path.join(root, '.claude', 'skills', 'agent-ready');
  if (fs.existsSync(path.join(root, '.cursor'))) return path.join(root, '.cursor', 'skills', 'agent-ready');
  return path.join(root, '.agents', 'skills', 'agent-ready');
}

function installSkill(root, to) {
  const target = to ? path.resolve(root, to) : defaultTarget(root);
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(SRC, target, { recursive: true });
  return path.relative(root, target) || target;
}

module.exports = { installSkill, defaultTarget };

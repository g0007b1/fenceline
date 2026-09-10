'use strict';
// skill: copy the fenceline skill into a skills directory the agent runtime reads,
// so "finish the setup with the fenceline skill" works from a fresh session.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'skill', 'fenceline');

function defaultTarget(root) {
  if (fs.existsSync(path.join(root, '.agents'))) return path.join(root, '.agents', 'skills', 'fenceline');
  if (fs.existsSync(path.join(root, '.claude'))) return path.join(root, '.claude', 'skills', 'fenceline');
  if (fs.existsSync(path.join(root, '.cursor'))) return path.join(root, '.cursor', 'skills', 'fenceline');
  return path.join(root, '.agents', 'skills', 'fenceline');
}

function installSkill(root, to) {
  const target = to ? path.resolve(root, to) : defaultTarget(root);
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(SRC, target, { recursive: true });
  return path.relative(root, target) || target;
}

module.exports = { installSkill, defaultTarget };

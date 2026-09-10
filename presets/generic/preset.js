'use strict';
module.exports = {
  id: 'generic',
  label: 'Generic',
  description: 'Any repository: git safety, secrets, scope discipline, stop-hook gates. Add your own bans in .agent-ready/config.json.',
  doctor: { allowPaths: ['src/main.txt'] },
};

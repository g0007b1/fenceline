'use strict';
module.exports = {
  id: 'python',
  label: 'Python',
  description: 'Django / FastAPI / Flask / libraries: migrations are human-only, destructive DB and package commands are blocked.',
  denyShell: [
    { re: /^(twine\s+upload|poetry\s+publish|uv\s+publish|flit\s+publish|hatch\s+publish)\b/, why: 'publishing to PyPI is human-only' },
    { re: /^pip3?\s+install\s+(?!.*(-r\s|--requirement|-e\s|\.$|\.\s))/, why: 'ad-hoc installs bypass the lockfile — add to pyproject/requirements instead', severity: 'ask' },
  ],
  rules: ['python-modules.mdc'],
  safeAuto: [
    'A new validation rule or error message inside an existing endpoint, with a test',
    'A pure function in a utils / services module with a pytest case',
    'Type annotations added to existing code without behaviour change',
  ],
  safeHuman: [
    'Auth, permissions, payments, anything that moves money or data across users',
    'Celery / RQ / cron tasks — anything with at-least-once semantics',
    'Changes to public API contracts consumed by other services (write a handoff instead)',
  ],
  triage: { human: ['migration', 'schema', 'backfill', 'celery', 'cron', 'permission', 'миграц', 'схем', 'права'] },
  doctor: { allowPaths: ['app/services/pricing.py'], denyShell: ['poetry publish'], askShell: ['pip install requests'], allowShell: ['pytest -q', 'ruff check .', 'pip install -r requirements.txt'] },
};

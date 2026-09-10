'use strict';
const path = require('path');
const { exists, read, stack } = require('./util');

const MARKERS = ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile', 'manage.py'];

// Pull dependency names out of pyproject / requirements without a TOML parser.
function depNamesFrom(pyproject, requirements, pipfile) {
  const names = new Set();
  const add = (s) => { const m = String(s).trim().match(/^["']?([A-Za-z0-9_.-]+)/); if (m && m[1]) names.add(m[1].toLowerCase().replace(/_/g, '-')); };
  // [project] dependencies = [...], [project.optional-dependencies] <group> = [...], [dependency-groups] <group> = [...]
  const sections = pyproject.split(/^(?=\[)/m);
  for (const sec of sections) {
    const header = (sec.match(/^\[([^\]]+)\]/) || [])[1] || '';
    if (!/^(project|project\.optional-dependencies|dependency-groups|build-system)$/.test(header.trim())) continue;
    const keyRe = header.trim() === 'project' ? /^\s*dependencies\s*=\s*\[([^\]]*)\]/gm : /^\s*[\w.-]+\s*=\s*\[([^\]]*)\]/gm;
    for (const m of sec.matchAll(keyRe)) m[1].split(/,|\n/).forEach((s) => { const t = s.trim().replace(/^["']|["'],?$/g, ''); if (t && !t.startsWith('#') && /^[A-Za-z]/.test(t)) add(t); });
  }
  for (const m of pyproject.matchAll(/\[tool\.poetry\.(?:dev-)?dependencies\]([\s\S]*?)(?=\n\[|$)/g)) m[1].split('\n').forEach((l) => { const k = l.split('=')[0].trim(); if (k && !k.startsWith('#') && k !== 'python') add(k); });
  for (const m of pyproject.matchAll(/\[tool\.poetry\.group\.[^\]]+\.dependencies\]([\s\S]*?)(?=\n\[|$)/g)) m[1].split('\n').forEach((l) => { const k = l.split('=')[0].trim(); if (k && !k.startsWith('#')) add(k); });
  requirements.split('\n').forEach((l) => { const t = l.trim(); if (t && !t.startsWith('#') && !t.startsWith('-')) add(t); });
  for (const m of pipfile.matchAll(/\[(?:dev-)?packages\]([\s\S]*?)(?=\n\[|$)/g)) m[1].split('\n').forEach((l) => { const k = l.split('=')[0].trim(); if (k && !k.startsWith('#')) add(k); });
  return [...names];
}

function detect(root) {
  if (!MARKERS.some((m) => exists(root, m))) return null;
  const pyproject = read(root, 'pyproject.toml');
  const requirements = [read(root, 'requirements.txt'), read(root, 'requirements-dev.txt'), read(root, 'requirements/dev.txt')].join('\n');
  const pipfile = read(root, 'Pipfile');
  const depNames = depNamesFrom(pyproject, requirements, pipfile);
  const has = (n) => depNames.includes(n) || new RegExp(`\\[tool\\.${n.replace(/[-.]/g, '\\$&')}\\b`).test(pyproject);

  const pm = exists(root, 'uv.lock') ? 'uv' : exists(root, 'poetry.lock') || /\[tool\.poetry\]/.test(pyproject) ? 'poetry' : exists(root, 'Pipfile') ? 'pipenv' : 'pip';
  const runPrefix = pm === 'uv' ? 'uv run ' : pm === 'poetry' ? 'poetry run ' : pm === 'pipenv' ? 'pipenv run ' : '';
  const name = (pyproject.match(/^\s*name\s*=\s*["']([^"']+)["']/m) || [])[1] || path.basename(root);

  const f = {
    django: has('django') || exists(root, 'manage.py'), fastapi: has('fastapi'), flask: has('flask'), starlette: has('starlette'),
    sqlalchemy: has('sqlalchemy'), alembic: has('alembic'), celery: has('celery'), pydantic: has('pydantic'),
    ruff: has('ruff'), flake8: has('flake8'), black: has('black'), mypy: has('mypy'), pyright: has('pyright'), pytest: has('pytest'),
  };
  const lint = f.ruff || exists(root, 'ruff.toml') ? `${runPrefix}ruff check .` : f.flake8 || exists(root, '.flake8') ? `${runPrefix}flake8` : null;
  const typeCheck = f.mypy || exists(root, 'mypy.ini') ? `${runPrefix}mypy .` : f.pyright || exists(root, 'pyrightconfig.json') ? `${runPrefix}pyright` : null;
  const test = f.pytest || exists(root, 'pytest.ini') || exists(root, 'tests') ? `${runPrefix}pytest -q` : f.django ? `${runPrefix}python manage.py test` : null;

  const suggestions = [];
  if (!lint) suggestions.push('Add ruff (`ruff check .`) — the stop-hook needs a lint command to enforce.');
  if (!typeCheck) suggestions.push('Add mypy or pyright so type errors block the agent instead of reaching review.');

  const summary = ['Python'];
  for (const [k, label] of [['django', 'Django'], ['fastapi', 'FastAPI'], ['flask', 'Flask'], ['sqlalchemy', 'SQLAlchemy'], ['alembic', 'Alembic'], ['celery', 'Celery'], ['pydantic', 'Pydantic'], ['pytest', 'pytest'], ['ruff', 'ruff'], ['mypy', 'mypy'], ['pyright', 'pyright']]) if (f[k]) summary.push(label);
  summary.push(pm);

  return stack({ ecosystem: 'python', name, language: 'python', packageManager: pm, runPrefix, depNames, frameworks: f,
    checks: { lint, typeCheck, test, build: null }, suggestions, summary });
}

module.exports = { id: 'python', detect };

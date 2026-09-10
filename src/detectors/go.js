'use strict';
const path = require('path');
const { exists, read, stack } = require('./util');

function detect(root) {
  if (!exists(root, 'go.mod')) return null;
  const mod = read(root, 'go.mod');
  const name = (mod.match(/^module\s+(\S+)/m) || [])[1] || path.basename(root);
  const depNames = [...mod.matchAll(/^\s*([a-z0-9.\-]+\/[^\s]+)\s+v[\d.]/gm)].map((m) => m[1].toLowerCase());
  const golangci = exists(root, '.golangci.yml') || exists(root, '.golangci.yaml') || exists(root, '.golangci.toml');
  const f = {
    gin: depNames.some((d) => d.includes('gin-gonic/gin')), echo: depNames.some((d) => d.includes('labstack/echo')), fiber: depNames.some((d) => d.includes('gofiber/fiber')),
    chi: depNames.some((d) => d.includes('go-chi/chi')), grpc: depNames.some((d) => d.includes('google.golang.org/grpc')),
    gorm: depNames.some((d) => d.includes('gorm.io')), sqlx: depNames.some((d) => d.includes('jmoiron/sqlx')), ent: depNames.some((d) => d.includes('entgo.io')),
    golangci,
  };
  const summary = ['Go'];
  for (const [k, label] of [['gin', 'Gin'], ['echo', 'Echo'], ['fiber', 'Fiber'], ['chi', 'chi'], ['grpc', 'gRPC'], ['gorm', 'GORM'], ['sqlx', 'sqlx'], ['ent', 'ent'], ['golangci', 'golangci-lint']]) if (f[k]) summary.push(label);
  const monorepo = exists(root, 'go.work');
  if (monorepo) summary.push('go workspace');
  return stack({ ecosystem: 'go', name, language: 'go', packageManager: 'go', depNames, frameworks: f, monorepo,
    checks: { lint: golangci ? 'golangci-lint run' : 'go vet ./...', typeCheck: 'go build ./...', test: 'go test ./...', build: 'go build ./...' },
    suggestions: golangci ? [] : ['Consider golangci-lint; `go vet` is the fallback lint gate.'], summary });
}

module.exports = { id: 'go', detect };

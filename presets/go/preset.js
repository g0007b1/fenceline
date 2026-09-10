'use strict';
module.exports = {
  id: 'go',
  label: 'Go',
  description: 'Go services and tools: migrations are human-only, generated code is protected, go vet / build / test are the gates.',
  denyWrite: [{ re: /\.pb\.go$/, label: 'protobuf output' }, { re: /(^|\/)gen\//, label: 'generated code (gen/)' }, { re: /_gen\.go$/, label: 'generated code (*_gen.go)' }, { re: /(^|\/)ent\/(?!schema\/)/, label: 'ent generated code' }],
  denyShell: [
    { re: /^go\s+get\s+-u\b/, why: 'bulk dependency upgrade — human-only', severity: 'ask' },
  ],
  rules: ['go-conventions.mdc'],
  hardBans: ['Generated code (`*.pb.go`, `gen/`, `*_gen.go`) is never hand-edited: change the source and regenerate.'],
  safeAuto: ['A pure function in an internal package with a table-driven test', 'A new validation rule or error message in an existing handler, with a test'],
  safeHuman: ['Auth, permissions, payments', 'Changes to protobuf / public API contracts (write a handoff instead)', 'Concurrency model changes (new goroutines, channels, worker pools)'],
  triage: { human: ['migration', 'proto', 'grpc contract', 'goroutine', 'worker pool', 'миграц', 'горутин'] },
  doctor: { denyPaths: ['api/v1/users.pb.go'], allowPaths: ['internal/pricing/pricing.go'], askShell: ['go get -u ./...'], allowShell: ['go test ./...'] },
};

// Test-only Cloud and execution boundary. Real CLI, npm installation, module
// imports and engine constructors run; no real account or browser is contacted.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const stage = process.env.FLOWSTRIDE_INSTALL_STAGE;
const cloud = process.env.FLOWSTRIDE_CLOUD_SOURCE;
const ts = require(path.join(cloud, 'node_modules/typescript'));
const { NextResponse } = require(path.join(cloud, 'node_modules/next/server.js'));
const token = 'test-install-machine-token';
const workspaceId = '222222222222222222222222';
const trace = event => fs.appendFileSync(path.join(stage, 'trace.jsonl'), JSON.stringify(event) + '\n');
const filename = path.join(cloud, 'src/app/api/workspace/download-pro/route.ts');
const compiledModule = { exports: {} };
const deps = {
  'next/server': { NextResponse }, crypto: require('node:crypto'),
  '@/lib/db': async () => {},
  '@/models/MachineToken': { findOne: async query => {
    const expected = require('node:crypto').createHash('sha256').update(token).digest('hex');
    if (query.tokenHash !== expected || query.isRevoked !== false) throw new Error('Invalid token query');
    return { workspace: workspaceId };
  } },
  '@/models/Workspace': { findById: async id => id === workspaceId ? { _id: workspaceId } : null },
  '@aws-sdk/client-s3': { S3Client: class {}, GetObjectCommand: class { constructor(input) { this.input = input; } } },
  '@aws-sdk/s3-request-presigner': { getSignedUrl: async (_client, command, options) => {
    if (command.input.Bucket !== 'flowstride-engine-vault' || command.input.Key !== 'flowstride-pro-1.0.14.tgz' || options.expiresIn !== 60) throw new Error('Unexpected archive reference');
    trace({ type: 'storage-reference', key: command.input.Key });
    return 'https://storage.example.invalid/private-pro.tgz';
  } },
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, {
  module: compiledModule, exports: compiledModule.exports,
  require(name) { if (!(name in deps)) throw new Error(`Unexpected download dependency: ${name}`); return deps[name]; },
  process: { env: { DO_SPACES_KEY: 'test-key', DO_SPACES_SECRET: 'test-secret' } },
  fetch: async url => {
    if (url !== 'https://storage.example.invalid/private-pro.tgz') throw new Error('Unexpected storage request');
    return new Response(fs.readFileSync(path.join(stage, 'pro.tgz')));
  },
  console,
}, { filename });

global.fetch = async (url, options = {}) => {
  const endpoint = new URL(url);
  if (endpoint.origin !== 'https://cloud.example.invalid') throw new Error(`Unexpected network origin: ${endpoint.origin}`);
  trace({ type: 'cloud-request', path: endpoint.pathname });
  if (endpoint.pathname === '/api/auth/cli-sync') {
    if (options.headers.Authorization !== `Bearer ${token}`) throw new Error('Invalid login authorization');
    return Response.json({ machineToken: token, workspaceId, isProEligible: true });
  }
  if (endpoint.pathname === '/api/workspace/download-pro') {
    return compiledModule.exports.GET(new Request(url, options));
  }
  if (endpoint.pathname === '/api/workspace/status') {
    if (options.headers.Authorization !== `Bearer ${token}`) throw new Error('Invalid Pro authorization');
    return Response.json({ workspace: { _id: workspaceId, name: 'Integration test', plan: 'business' }, manifest: { maxWorkers: 'unlimited' } });
  }
  if (endpoint.pathname === '/api/auth/verify-cli') {
    if (options.headers.Authorization === 'Bearer test-revoked-token') return Response.json({ error: 'Revoked' }, { status: 401 });
    if (options.headers.Authorization !== `Bearer ${token}`) throw new Error('Invalid handoff authorization');
    return Response.json({ tier: 'business', workspaceName: 'Integration test' });
  }
  throw new Error(`Unexpected network endpoint: ${endpoint.pathname}`);
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  const exported = originalLoad.apply(this, arguments);
  const resolved = Module._resolveFilename(request, parent, isMain);
  if (typeof resolved !== 'string') return exported;
  if (resolved.includes('/node_modules/axios/')) {
    exported.get = async (url, options) => {
      const response = await global.fetch(url, options);
      if (!response.ok) throw new Error('Mocked authorization denied');
      return { data: await response.json() };
    };
  }
  const engine = resolved.includes('/node_modules/@flowstride/pro/') ? 'pro'
    : resolved.includes('/node_modules/flowstride/') ? 'os' : null;
  if (engine && resolved.endsWith('/runner/flow_worker.js') && !exported.__handoffTestWorker) {
    const Original = exported.FlowWorker;
    exported.FlowWorker = class extends Original {
      constructor(...args) { super(...args); trace({ type: 'worker', engine }); }
    };
    exported.__handoffTestWorker = true;
  }
  if (engine && resolved.endsWith('/runner/flow_orchestrator.js') && !exported.__handoffTestOrchestrator) {
    const Original = exported.FlowOrchestrator;
    exported.FlowOrchestrator = class extends Original {
      constructor(...args) { super(...args); trace({ type: 'orchestrator', engine }); }
      async start(target) {
        if (!fs.existsSync(target)) throw new Error('Handoff lost the target directory');
        trace({ type: 'start', engine, target });
        const fileName=path.basename(fs.readdirSync(target).find(name=>name.endsWith('.flow')));
        this.worker.emit('worker_event',{type:'STEP_UPDATE',payload:{id:'smoke-step',fileName,status:'passed'}});
        this.worker.emit('worker_event',{type:'FILE_COMPLETE',payload:{fileName}});
        return true;
      }
    };
    exported.__handoffTestOrchestrator = true;
  }
  return exported;
};

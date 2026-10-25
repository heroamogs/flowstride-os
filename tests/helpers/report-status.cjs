const path = require('node:path');
const { createRequire, Module } = require('node:module');
const root = process.env.FLOWSTRIDE_ENGINE_ROOT || path.resolve(__dirname, '../..');
const ui = path.join(root, 'src/ui');
const requireUI = createRequire(path.join(ui, 'package.json'));
const requireEngine = createRequire(path.join(root, 'package.json'));
const esbuild = requireUI('esbuild');
function loadSource(relativePath) {
  const code = esbuild.buildSync({
    entryPoints: [path.join(root, relativePath)], bundle: true, write: false,
    platform: 'node', format: 'cjs', external: ['playwright'],
  }).outputFiles[0].text;
  const compiled = new Module(path.join(root, '.report-status-test.cjs'));
  compiled.paths = Module._nodeModulePaths(root);
  compiled._compile(code, path.join(root, '.report-status-test.cjs'));
  return compiled.exports;
}
const states = [
  ['pass', 'passed', 'PASSED', 'Action verified successfully.'],
  ['PASSED', 'passed', 'PASSED', 'Action verified successfully.'],
  ['success', 'passed', 'PASSED', 'Action verified successfully.'],
  ['failed', 'failed', 'FAILED', 'Validation failed.'],
  ['FAIL', 'failed', 'FAILED', 'Validation failed.'],
  ['error', 'error', 'ERROR', 'Step execution failed.'],
  ['skipped', 'skipped', 'SKIPPED', 'Step skipped; not executed.'],
  ['not_tested', 'not_tested', 'NOT TESTED', 'Step not tested.'],
  ['pending', 'pending', 'PENDING', 'Awaiting execution.'],
  ['running', 'running', 'RUNNING', 'Execution in progress.'],
  ['cancelled', 'cancelled', 'CANCELLED', 'Execution cancelled.'],
  ['interrupted', 'interrupted', 'INTERRUPTED', 'Execution interrupted.'],
  ['blocked', 'blocked', 'BLOCKED', 'Execution blocked.'],
  ['unrecognized', 'unknown', 'UNKNOWN', 'Result unavailable.'],
  [undefined, 'pending', 'PENDING', 'Awaiting execution.'],
];
const attack = '<img src="https://attacker.invalid/leak" onerror="globalThis.reportInjected=true"><script>globalThis.reportInjected=true</script>&';
function scenario(fileName = '__proto__') {
  return { fileName, name: 'Truthful reporting', steps: states.map(([status], index) => ({
    id: `step-${index}`, command: `action-${index}`, type: 'When', description: `Expected result ${index}`, status,
  })) };
}
module.exports = { root, ui, requireUI, requireEngine, esbuild, loadSource, states, attack, scenario };

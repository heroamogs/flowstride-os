import fs from 'node:fs';
import path from 'node:path';
import { loadNativeConfig } from './config';

export function initCI(provider: string) {
  if (provider !== 'github') throw new Error('Supported provider: github.');
  const file=path.resolve('.github/workflows/flowstride.yml');
  if (fs.existsSync(file)) throw new Error('Flowstride workflow already exists; it was not overwritten.');
  const artifacts = path.relative(process.cwd(), loadNativeConfig(process.cwd(), {}).artifactsDir!);
  const parent=path.dirname(file); fs.mkdirSync(parent,{recursive:true});
  fs.writeFileSync(file, `name: Flowstride\non:\n  push:\n  pull_request:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    timeout-minutes: 20\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n        with:\n          persist-credentials: false\n      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020\n        with:\n          node-version: 24\n          cache: npm\n      - run: npm ci\n      - name: Install matching browser dependencies\n        run: npx --no-install flowstride install --with-deps\n      - name: Run native Flowstride\n        run: npx --no-install flowstride run --ci\n      - name: Retain test evidence\n        if: always()\n        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02\n        with:\n          name: flowstride-results\n          path: ${JSON.stringify(artifacts + "/")}\n          retention-days: 14\n`, {flag:'wx'});
  console.log(`Created ${file}. Commit it when ready. This template uses the project-locked Flowstride installation.`);
}

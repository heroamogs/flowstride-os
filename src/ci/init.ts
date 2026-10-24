import fs from 'node:fs';
import path from 'node:path';
import { loadNativeConfig } from './config';

export function initCI(provider: string, options: { browsers?: string; shards?: string } = {}) {
  if (provider !== 'github') throw new Error('Supported provider: github.');
  const browsers = (options.browsers || 'chromium').split(',');
  const shards = Number(options.shards || 1);
  if (!browsers.length || new Set(browsers).size !== browsers.length || browsers.some(browser => !['chromium','firefox','webkit'].includes(browser))) throw new Error('Choose unique browser names separated by commas.');
  if (!Number.isSafeInteger(shards) || shards < 1 || shards > 256) throw new Error('shards must be 1..256.');
  const matrix = browsers.length > 1 || shards > 1;
  const strategy = matrix ? `\n    strategy:\n      fail-fast: false\n      matrix:\n        browser: ${JSON.stringify(browsers)}\n        shard: ${JSON.stringify(Array.from({ length:shards },(_,index) => index+1))}` : '';
  const selection = matrix ? ' --browser ${{ matrix.browser }} --shard ${{ matrix.shard }}/'+shards : browsers[0] !== 'chromium' ? ' --browser '+browsers[0] : '';
  const install = matrix ? ' ${{ matrix.browser }}' : ' '+browsers[0];
  const artifact = matrix ? 'flowstride-results-${{ matrix.browser }}-${{ matrix.shard }}' : 'flowstride-results';
  const file=path.resolve('.github/workflows/flowstride.yml');
  if (fs.existsSync(file)) throw new Error('Flowstride workflow already exists; it was not overwritten.');
  const artifacts = path.relative(process.cwd(), loadNativeConfig(process.cwd(), {}).artifactsDir!);
  const parent=path.dirname(file); fs.mkdirSync(parent,{recursive:true});
  fs.writeFileSync(file, `name: Flowstride\non:\n  push:\n  pull_request:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    timeout-minutes: 20${strategy}\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262\n        with:\n          persist-credentials: false\n      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020\n        with:\n          node-version: 24\n          cache: npm\n      - run: npm ci\n      - name: Install matching browser dependencies\n        run: npx --no-install flowstride install --with-deps${install}\n      - name: Run native Flowstride\n        run: npx --no-install flowstride run --ci${selection}\n      - name: Retain test evidence\n        if: always()\n        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02\n        with:\n          name: ${artifact}\n          path: ${JSON.stringify(artifacts + "/")}\n          retention-days: 14\n`, {flag:'wx'});
  console.log(`Created ${file}. Commit it when ready. This template uses the project-locked Flowstride installation.`);
}

import { z } from 'zod';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import type { Page } from 'playwright';
import type { ViteDevServer } from 'vite';
import type { FlowstrideConfig } from '../types';
import { projectPath } from '../utils/projectPaths';
import { randomUUID } from 'node:crypto';
const schema = z.object({ module: z.string().min(1), framework: z.enum(['vanilla','react','vue']), export: z.string().regex(/^[a-zA-Z_$][\w$]*$/).default('default'), props: z.record(z.string(), z.unknown()).default({}), css: z.array(z.string()).default([]) }).strict();
export class NativeComponents {
  private server?: ViteDevServer;
  private page?: Page;
  private mounted = false;
  private framework?: string;
  constructor(private config: FlowstrideConfig) {}
  async execute(page: Page, action: string, input: unknown) {
    if (action === 'mount') {
      const data = schema.parse(input); await this.dispose();
      const root = this.config.projectRoot || process.cwd(), module = projectPath(root, data.module);
      const css = data.css.map(file => '/' + path.relative(root, projectPath(root, file)).split(path.sep).join('/'));
      const projectRequire = createRequire(path.join(root, 'package.json'));
      // Resolve project framework runtimes before starting any server.
      if (data.framework === 'react') { projectRequire.resolve('react'); projectRequire.resolve('react-dom/client'); }
      if (data.framework === 'vue') projectRequire.resolve('vue');
      const { createServer } = await import('vite');
      const plugins: any[] = [];
      if (data.framework === 'react') { const { default: react } = await import('@vitejs/plugin-react'); plugins.push(react({ jsxRuntime: 'automatic' })); }
      if (data.framework === 'vue') { const { default: vue } = await import('@vitejs/plugin-vue'); plugins.push(vue()); }
      const entry = `/__flowstride_component_${randomUUID()}`;
      const moduleURL = '/' + path.relative(root, module).split(path.sep).join('/');
      const importComponent = `import { ${data.export} as component } from ${JSON.stringify(moduleURL)};`;
      const styles = css.map(file => `import ${JSON.stringify(file)};`).join('\n');
      let kernel: string;
      if (data.framework === 'react') kernel = `import React from 'react'; import {createRoot} from 'react-dom/client'; const root = createRoot(target); export function update(props){root.render(React.createElement(component,props));} export function unmount(){root.unmount();}`;
      else if (data.framework === 'vue') kernel = `import {createApp,h,reactive} from 'vue'; const props=reactive({}); const app=createApp({render:()=>h(component,props)}); app.mount(target); export function update(next){for(const key of Object.keys(props))delete props[key];Object.assign(props,next);} export function unmount(){app.unmount();}`;
      else kernel = `let current; export function update(props){current?.unmount?.();target.replaceChildren();current=component(target,props);if(current instanceof Node)target.appendChild(current);} export function unmount(){current?.unmount?.();target.replaceChildren();}`;
      const source = `${importComponent}\n${styles}\nconst target=document.getElementById('flowstride-component-root');\n${kernel}`;
      plugins.push({ name:'flowstride-component-module', resolveId(id: string) { if(id === entry+'.js') return '\0'+entry; }, load(id: string) { if(id === '\0'+entry) return source; } });
      plugins.push({ name: 'flowstride-component-entry', configureServer(server: ViteDevServer) {
        server.middlewares.use((req, res, next) => {
          const host = `127.0.0.1:${(server.httpServer!.address() as any)?.port}`;
          if (req.headers.host !== host || req.headers.origin && req.headers.origin !== `http://${host}`) { res.statusCode = 403; res.end('Forbidden'); return; }
          if (req.url?.split('?')[0] !== entry) return next();
          res.setHeader('Content-Type','text/html'); res.setHeader('Cache-Control','no-store');
          res.end('<!doctype html><html><head><title>Flowstride component test</title></head><body><div id="flowstride-component-root"></div></body></html>');
        });
      } });
      this.server = await createServer({ configFile: false, root, plugins, logLevel: 'error', cacheDir: projectPath(root, '.flowstride/component-cache'),
        server: { host: '127.0.0.1', port: 0, cors: false, hmr: false, watch: null, fs: { strict: true, allow: [root], deny: ['.env', '.env.*', '**/.flowstride/**', '**/.git/**', '*.{crt,pem,key}'] } },
        optimizeDeps: { noDiscovery: true, include: data.framework === 'react' ? ['react','react-dom/client'] : data.framework === 'vue' ? ['vue'] : [] }, appType: 'custom' });
      try {
        await this.server.listen(); const address = this.server.httpServer!.address() as any;
        await page.goto(`http://127.0.0.1:${address.port}${entry}`);
        await page.evaluate(async ({ entry, props }) => {
          const mod = await import(entry + '.js');
          (window as any).__FLOWSTRIDE_COMPONENT__ = mod; mod.update(props);
        }, { entry, props: data.props });
        this.page = page; this.mounted = true; this.framework = data.framework;
      } catch (error) { await this.dispose(); throw error; }
      return;
    }
    if (!this.mounted || page !== this.page) throw new Error('Mount a component on this page first.');
    if (action === 'update') { const data = z.object({ props: z.record(z.string(), z.unknown()) }).strict().parse(input); await page.evaluate(props => (window as any).__FLOWSTRIDE_COMPONENT__.update(props), data.props); return; }
    if (action === 'unmount') { z.object({}).strict().parse(input); await page.evaluate(() => (window as any).__FLOWSTRIDE_COMPONENT__.unmount()); this.mounted = false; return; }
    throw new Error(`Unknown component action: ${action}`);
  }
  async dispose() {
    if (this.mounted && this.page && !this.page.isClosed()) await this.page.evaluate(() => (window as any).__FLOWSTRIDE_COMPONENT__?.unmount()).catch(() => {});
    this.mounted = false; this.page = undefined;
    await this.server?.close(); this.server = undefined;
  }
}

import { withDeadline } from '../ci/deadline';
import fs from 'node:fs';
import { GameSDK } from '../game/sdk';
import * as path from "path";
import { FlowstrideConfig, FlowstrideSDK, PluginAction } from "../types";
import { ApiProxy } from "../sdk/api_proxy";
import { DbProxy } from "../sdk/db_proxy";
import { TemporaryStore } from "./temporary_store";
import { WebAdapter } from "../adapters/web/playwright";

export class PluginManager {
  private apiProxy: ApiProxy;
  private dbProxy: DbProxy;
  private game: GameSDK;

  constructor(
    private config: FlowstrideConfig,
    private web: WebAdapter,
    private store: TemporaryStore,
    apiProxy: ApiProxy,
  ) {
    this.apiProxy = apiProxy;
    this.dbProxy = new DbProxy();
    this.game = new GameSDK(() => this.web.getPage(), this.config);
  }

  public async execute(
    actionName: string,
    args: any,
    saveAs?: string,
  ): Promise<any> {
    const lastDotIndex = actionName.lastIndexOf(".");
    if (lastDotIndex === -1) {
      throw new Error(
        `Invalid plugin action format: "${actionName}". Expected "path.method"`,
      );
    }

    const pluginFile = actionName.substring(0, lastDotIndex);
    const functionName = actionName.substring(lastDotIndex + 1);

    if (pluginFile === 'flowstride:game') {
      const actions = ['tap','drag','swipe','key','checkpoint','snapshot','expectVisual','state','expectState','snapshotState','expectPreserved','fixture','select'];
      if (!actions.includes(functionName)) throw new Error(`Unknown native game action: ${functionName}`);
      const operation = (this.game as any)[functionName](args);
      const result = this.config.ci ? await withDeadline(operation, this.config.timeout) : await operation;
      if (saveAs) this.store.set(saveAs, result);
      return result;
    }

    let fullPath: string;

    if (pluginFile.includes("/") || pluginFile.includes("\\")) {
      fullPath = path.resolve(process.cwd(), `${pluginFile}.ts`);
    } else {
      const pluginsPath =
        this.config.pluginsDir || path.join(process.cwd(), "plugins");
      fullPath = path.resolve(pluginsPath, `${pluginFile}.ts`);
    }

    try {
      let module: any;

      if (fullPath.endsWith(".ts")) {
        require("ts-node").register({
          transpileOnly: true,
          compilerOptions: {
            module: "commonjs",
            esModuleInterop: true,
          },
        });

        module = require(fullPath);
      } else {
        module = await import(fullPath);
      }

      const action: PluginAction = module[functionName];

      if (!action) {
        throw new Error(
          `Plugin function "${functionName}" not found in ${fullPath}`,
        );
      }

      const sdk: FlowstrideSDK = {
        game: this.game,
        browser: { page: () => this.web.getPage() },
        run: { device: this.config.device || 'desktop', artifactsDir: this.config.artifactsDir || path.resolve('flowstride-artifacts'),
          attach: (name: string, data: string | Buffer) => {
            if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name === '.' || name === '..') throw new Error('Attachment name must be a simple filename.');
            const directory = this.config.artifactsDir || path.resolve('flowstride-artifacts');
            fs.mkdirSync(directory, { recursive: true });
            const prefix = this.config.testFile ? this.config.testFile.replace(/[^a-zA-Z0-9_.-]/g, '_')+'-' : '';
            const file = path.join(directory, prefix+name); fs.writeFileSync(file, data); return file;
          } },
        api: {
          get: (url: string, headers?: Record<string, string>) =>
            this.apiProxy.get(url, headers),
          post: (url: string, body: any, headers?: Record<string, string>) =>
            this.apiProxy.post(url, body, headers),
          put: (url: string, body: any, headers?: Record<string, string>) =>
            (this.apiProxy as any).put(url, body, headers),
          delete: (url: string, headers?: Record<string, string>) =>
            (this.apiProxy as any).delete(url, headers),
        },
        ui: {
          click: (s: string) => this.web.click(s),
          type: (s: string, t: string) => this.web.type(s, t),
          isVisible: async (s: string) => {
            try {
              await this.web.expectVisible(s);
              return true;
            } catch {
              return false;
            }
          },
          getText: async (s: string) => {
            const page = this.web.getPage();
            const text = await page.locator(s).first().textContent();
            return text ? text.trim() : "";
          },
        },
        state: {
          get: (k: string) => this.store.get(k),
          set: (k: string, v: any) => this.store.set(k, v),
        },
        env: {
          get: (k: string) => process.env[k],
        },
        db: this.dbProxy,
        otp: {
          generate: (secret: string) => `OTP_FOR_${secret}`,
        },
        log: (m: string) => console.log(`[Plugin Log]: ${m}`),
        expect: {
          visible: async (s: string) => {
            try {
              await this.web.expectVisible(s);
              return true;
            } catch {
              throw new Error(
                `Assertion Failed: Expected element "${s}" to be visible.`,
              );
            }
          },
          equals: (actual: any, expected: any, message?: string) => {
            if (actual !== expected) {
              throw new Error(
                message ||
                  `Assertion Failed: Expected "${expected}", but got "${actual}".`,
              );
            }
          },
          contains: (
            actual: string | any[],
            expected: any,
            message?: string,
          ) => {
            if (!actual.includes(expected)) {
              throw new Error(
                message ||
                  `Assertion Failed: Expected "${actual}" to contain "${expected}".`,
              );
            }
          },
        },
        utils: {
          sleep: (ms: number) =>
            new Promise((resolve) => setTimeout(resolve, ms)),
          generateId: (length: number = 8) =>
            Math.random()
              .toString(36)
              .substring(2, 2 + length),
        },
      };

      const operation = action(sdk, args);
      const result = this.config.ci ? await withDeadline(operation, this.config.timeout) : await operation;

      if (saveAs) {
        this.store.set(saveAs, result);
      }

      return result;
    } catch (error: any) {
      throw new Error(
        `Plugin Execution Failed (${actionName}): ${error.message}`,
      );
    }
  }
}

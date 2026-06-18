"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginManager = void 0;
const path = __importStar(require("path"));
const db_proxy_1 = require("../sdk/db_proxy");
class PluginManager {
    config;
    web;
    store;
    apiProxy;
    dbProxy;
    constructor(config, web, store, apiProxy) {
        this.config = config;
        this.web = web;
        this.store = store;
        this.apiProxy = apiProxy;
        this.dbProxy = new db_proxy_1.DbProxy();
    }
    async execute(actionName, args, saveAs) {
        const lastDotIndex = actionName.lastIndexOf(".");
        if (lastDotIndex === -1) {
            throw new Error(`Invalid plugin action format: "${actionName}". Expected "path.method"`);
        }
        const pluginFile = actionName.substring(0, lastDotIndex);
        const functionName = actionName.substring(lastDotIndex + 1);
        let fullPath;
        if (pluginFile.includes("/") || pluginFile.includes("\\")) {
            fullPath = path.resolve(process.cwd(), `${pluginFile}.ts`);
        }
        else {
            const pluginsPath = this.config.pluginsDir || path.join(process.cwd(), "plugins");
            fullPath = path.resolve(pluginsPath, `${pluginFile}.ts`);
        }
        try {
            let module;
            if (fullPath.endsWith(".ts")) {
                require("ts-node").register({
                    transpileOnly: true,
                    compilerOptions: {
                        module: "commonjs",
                        esModuleInterop: true,
                    },
                });
                module = require(fullPath);
            }
            else {
                module = await import(fullPath);
            }
            const action = module[functionName];
            if (!action) {
                throw new Error(`Plugin function "${functionName}" not found in ${fullPath}`);
            }
            const sdk = {
                api: {
                    get: (url, headers) => this.apiProxy.get(url, headers),
                    post: (url, body, headers) => this.apiProxy.post(url, body, headers),
                    put: (url, body, headers) => this.apiProxy.put(url, body, headers),
                    delete: (url, headers) => this.apiProxy.delete(url, headers),
                },
                ui: {
                    click: (s) => this.web.click(s),
                    type: (s, t) => this.web.type(s, t),
                    isVisible: async (s) => {
                        try {
                            await this.web.expectVisible(s);
                            return true;
                        }
                        catch {
                            return false;
                        }
                    },
                    getText: async (s) => {
                        const page = this.web.getPage();
                        const text = await page.locator(s).first().textContent();
                        return text ? text.trim() : "";
                    },
                },
                state: {
                    get: (k) => this.store.get(k),
                    set: (k, v) => this.store.set(k, v),
                },
                env: {
                    get: (k) => process.env[k],
                },
                db: this.dbProxy,
                otp: {
                    generate: (secret) => `OTP_FOR_${secret}`,
                },
                log: (m) => console.log(`[Plugin Log]: ${m}`),
                expect: {
                    visible: async (s) => {
                        try {
                            await this.web.expectVisible(s);
                            return true;
                        }
                        catch {
                            throw new Error(`Assertion Failed: Expected element "${s}" to be visible.`);
                        }
                    },
                    equals: (actual, expected, message) => {
                        if (actual !== expected) {
                            throw new Error(message ||
                                `Assertion Failed: Expected "${expected}", but got "${actual}".`);
                        }
                    },
                    contains: (actual, expected, message) => {
                        if (!actual.includes(expected)) {
                            throw new Error(message ||
                                `Assertion Failed: Expected "${actual}" to contain "${expected}".`);
                        }
                    },
                },
                utils: {
                    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
                    generateId: (length = 8) => Math.random()
                        .toString(36)
                        .substring(2, 2 + length),
                },
            };
            const result = await action(sdk, args);
            if (saveAs) {
                this.store.set(saveAs, result);
            }
            return result;
        }
        catch (error) {
            throw new Error(`Plugin Execution Failed (${actionName}): ${error.message}`);
        }
    }
}
exports.PluginManager = PluginManager;

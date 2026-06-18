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
exports.runAction = runAction;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const dotenv = __importStar(require("dotenv"));
const os = __importStar(require("os"));
const url_1 = require("url");
const flow_worker_1 = require("../../runner/flow_worker");
const flow_orchestrator_1 = require("../../runner/flow_orchestrator");
const playwright_1 = require("../../adapters/web/playwright");
const undici_1 = require("../../adapters/api/undici");
const temporary_store_1 = require("../../runner/temporary_store");
const manager_1 = require("../../sessions/manager");
const persistent_vault_1 = require("../../runner/persistent_vault");
const plugin_manager_1 = require("../../runner/plugin_manager");
const api_proxy_1 = require("../../sdk/api_proxy");
async function runAction(targetPath, options) {
    const root = process.cwd();
    const profileEnvPath = options.env
        ? path.resolve(root, `.env.${options.env}`)
        : null;
    const defaultEnvPath = path.resolve(root, ".env");
    if (profileEnvPath) {
        if (fs.existsSync(profileEnvPath)) {
            dotenv.config({ path: profileEnvPath });
            console.log(`[Environment]: Loaded profile "${options.env}"`);
        }
        else {
            console.warn(`[Environment Warning]: --env ${options.env} was passed, but .env.${options.env} does not exist.`);
        }
    }
    if (fs.existsSync(defaultEnvPath)) {
        dotenv.config({ path: defaultEnvPath });
        if (!options.env) {
            console.log(`[Environment]: Loaded default .env file`);
        }
    }
    const isCI = !!(process.env.CI ||
        process.env.GITHUB_ACTIONS ||
        process.env.GITLAB_CI ||
        process.env.CIRCLECI ||
        process.env.JENKINS_URL ||
        process.env.FLOWSTRIDE_API_KEY);
    if (isCI) {
        console.log("\n[CI/CD]: Environment detected. Engaging Smart Automation Behaviors...");
    }
    const resolvedPath = targetPath;
    if (!fs.existsSync(resolvedPath)) {
        console.error(`\n[Error]: Cannot find strict target path "${resolvedPath}".`);
        process.exit(1);
    }
    console.log(`\n[Flowstride]: Starting execution suite at "${resolvedPath}"...`);
    const configPath = path.resolve(root, "flowstride.config.json");
    let localConfig = {};
    if (fs.existsSync(configPath)) {
        try {
            const fileContent = fs.readFileSync(configPath, "utf-8");
            localConfig = JSON.parse(fileContent);
            console.log(`[Config]: Loaded project configuration from flowstride.config.json`);
        }
        catch (e) {
            console.warn(`[Warning]: Could not parse flowstride.config.json: ${e.message}`);
        }
    }
    const config = {
        headless: isCI ? true : (options.headless ?? localConfig.headless ?? true),
        timeout: localConfig.timeout ?? 30000,
        bail: options.bail ?? localConfig.bail ?? false,
        baseUrl: process.env.BASE_URL ?? localConfig.baseUrl,
        defaultDialogBehavior: isCI
            ? "dismiss"
            : (localConfig.defaultDialogBehavior ?? "dismiss"),
        pluginsDir: localConfig.pluginsDir,
    };
    if (isCI) {
        console.log(`   > Headless Mode: ${config.headless ? "Forced ON" : "OFF"}`);
        console.log(`   > Dialog Protection: ${(config.defaultDialogBehavior || "dismiss").toUpperCase()}`);
        console.log(`   > Artifact Auto-Staging: ENABLED\n`);
    }
    let workerCount = options.workers ? parseInt(options.workers, 10) : 1;
    if (isNaN(workerCount) || workerCount < 1) {
        console.error(`\n[Error]: Invalid worker count "${options.workers}". Must be an integer greater than 0.`);
        process.exit(1);
    }
    const maxSafeWorkers = Math.max(1, os.cpus().length - 1);
    if (workerCount > maxSafeWorkers) {
        console.log(`\n[Warning]: You requested ${workerCount} workers, but your CPU only safely supports ${maxSafeWorkers}.`);
        console.log(`[Warning]: Auto-capping to ${maxSafeWorkers} workers to prevent system thrashing and crashes.\n`);
        workerCount = maxSafeWorkers;
    }
    const web = new playwright_1.WebAdapter(config);
    const api = new undici_1.ApiAdapter(config);
    const store = new temporary_store_1.TemporaryStore();
    const apiProxy = new api_proxy_1.ApiProxy(api);
    const pluginManager = new plugin_manager_1.PluginManager(config, web, store, apiProxy);
    const vault = new persistent_vault_1.PersistentVault(root);
    const sessions = new manager_1.SessionManager(web, api, vault);
    // ==========================================
    // DYNAMIC ENGINE ROUTER (The Plugin Handoff)
    // ==========================================
    let ActiveFlowWorker = flow_worker_1.FlowWorker;
    let ActiveFlowOrchestrator = flow_orchestrator_1.FlowOrchestrator;
    let engineMode = "Open Source";
    const proWorkerPath = path.join(process.cwd(), "node_modules", "@flowstride", "pro", "dist", "runner", "flow_worker.js");
    const proOrchPath = path.join(process.cwd(), "node_modules", "@flowstride", "pro", "dist", "runner", "flow_orchestrator.js");
    // We only attempt to load the Pro Engine if the DRM Bouncer (index.ts) did NOT force OS Mode
    if (!options.forceOS &&
        fs.existsSync(proWorkerPath) &&
        fs.existsSync(proOrchPath)) {
        try {
            const proWorkerModule = await import((0, url_1.pathToFileURL)(proWorkerPath).href);
            const proOrchModule = await import((0, url_1.pathToFileURL)(proOrchPath).href);
            ActiveFlowWorker = proWorkerModule.FlowWorker;
            ActiveFlowOrchestrator = proOrchModule.FlowOrchestrator;
            engineMode = "Enterprise (Pro)";
        }
        catch (err) {
            console.warn(`\n[Warning]: Found @flowstride/pro but failed to boot it. Falling back to Open Source engine. (${err.message})`);
        }
    }
    console.log(`\n[Engine]: Booting Flowstride in ${engineMode} mode...`);
    // ==========================================
    const worker = new ActiveFlowWorker(config, web, api, store, sessions, pluginManager);
    const orchestrator = new ActiveFlowOrchestrator(worker, workerCount, config);
    try {
        await orchestrator.start(resolvedPath);
        console.log("\n[Flowstride]: Execution suite completed successfully.");
        if (isCI) {
            const artifactsDir = path.resolve(root, "flowstride-artifacts");
            if (!fs.existsSync(artifactsDir)) {
                fs.mkdirSync(artifactsDir, { recursive: true });
            }
            console.log(`[CI Artifacts]: Test environment artifacts auto-staged to ./flowstride-artifacts/`);
            process.exit(0);
        }
        else {
            console.log("\n[Dashboard]: Server remains active for Replay and Debugging. Press Ctrl+C to exit.");
            await new Promise(() => { });
        }
    }
    catch (error) {
        console.error("\n[Fatal Error]:", error.message);
        if (isCI) {
            console.log(`[CI Alert]: Terminating pipeline with exit code 1 to block deployment.`);
        }
        process.exit(1);
    }
}

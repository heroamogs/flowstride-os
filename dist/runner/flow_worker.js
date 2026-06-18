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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowWorker = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const events_1 = require("events");
const lexer_1 = require("../parser/lexer");
const parser_1 = require("../parser/parser");
const data_generators_1 = require("./data_generators");
const dom_stripper_1 = require("./dom_stripper");
class FlowWorker extends events_1.EventEmitter {
    config;
    web;
    api;
    store;
    sessions;
    pluginManager;
    isSilent = process.env.FLOWSTRIDE_PARALLEL === "true";
    isAborted = false;
    currentStepContext = "Initializing...";
    currentFileName = "System";
    activeAudioPath = undefined;
    currentCdpSession = null;
    dataGen = null;
    localVariables = {};
    localBrowserSessions = {};
    static globalVariables = {};
    static globalBrowserSessions = {};
    lastApiUrl = "";
    constructor(config, web, api, store, sessions, pluginManager) {
        super();
        this.config = config;
        this.web = web;
        this.api = api;
        this.store = store;
        this.sessions = sessions;
        this.pluginManager = pluginManager;
    }
    broadcast(type, payload) {
        this.emit("worker_event", { type, payload });
    }
    emitLog(type, status, summary, details, customId, overrideFileName) {
        const id = customId || Math.random().toString(36).substr(2, 9);
        this.broadcast("LOG_EVENT", {
            id,
            timestamp: new Date().toLocaleTimeString(),
            type,
            status,
            summary,
            stepContext: this.currentStepContext,
            details,
            fileName: overrideFileName || this.currentFileName,
        });
        return id;
    }
    translateError(error, action, payload) {
        const msg = error.message || String(error);
        if (msg.includes("API Assertion Failed") ||
            msg.includes("Network Execution Error") ||
            msg.includes("Extraction Failed") ||
            msg.includes("Plugin Execution Failed") ||
            msg.includes("Scoping Error"))
            return msg;
        const target = payload.selector || payload.text || payload.url || "the element";
        if (msg.includes("Timeout"))
            return `I waited for "${target}" to appear, but it never did.`;
        if (msg.includes("intercepted"))
            return `I found "${target}", but another element is blocking it.`;
        if (msg.includes("Framework rejected"))
            return msg;
        return `An error occurred while trying to ${action}: ${msg.split("\n")[0]}`;
    }
    async captureStepContext(payload) {
        const page = this.web.getPage();
        const context = {};
        try {
            const buffer = await page.screenshot({ type: "jpeg", quality: 50 });
            context.screenshot = buffer.toString("base64");
        }
        catch (e) { }
        if (payload && payload.selector) {
            try {
                const box = await page
                    .locator(payload.selector)
                    .boundingBox({ timeout: 500 });
                if (box) {
                    context.boundingBox = box;
                }
            }
            catch (e) { }
        }
        return context;
    }
    resolveTextVariables(text) {
        let resolved = text;
        resolved = resolved.replace(/\{\{env\.([a-zA-Z0-9_]+)\}\}/g, (_, varName) => {
            const val = process.env[varName];
            if (val === undefined) {
                throw new Error(`Environment Error: The variable "{{env.${varName}}}" is undefined. Make sure it is set in your OS or .env file.`);
            }
            return val;
        });
        resolved = resolved.replace(/@global\[(.*?)\]/g, (_, varName) => {
            const val = FlowWorker.globalVariables[varName];
            if (val === undefined)
                throw new Error(`State Error: Global variable "@global[${varName}]" is undefined.`);
            return val;
        });
        resolved = resolved.replace(/@([a-zA-Z0-9_]+)/g, (match, varName) => {
            const val = this.localVariables[varName];
            return val !== undefined ? val : match;
        });
        return resolved;
    }
    resolveTemplateData(obj) {
        if (typeof obj === "string") {
            let text = this.resolveTextVariables(obj);
            if (this.dataGen)
                text = this.dataGen.resolve(text);
            return text;
        }
        if (Array.isArray(obj))
            return obj.map((item) => this.resolveTemplateData(item));
        if (obj !== null && typeof obj === "object") {
            const resolvedObj = {};
            for (const [key, value] of Object.entries(obj)) {
                resolvedObj[key] = this.resolveTemplateData(value);
            }
            return resolvedObj;
        }
        return obj;
    }
    extractFromJsonPath(obj, path) {
        if (!obj)
            return undefined;
        const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
        let current = obj;
        for (const part of parts) {
            if (current === undefined || current === null)
                return undefined;
            current = current[part];
        }
        return current;
    }
    processExtractions(extracts) {
        if (!extracts || extracts.length === 0)
            return;
        const state = this.api.getState();
        for (const ext of extracts) {
            let val;
            if (ext.target === "resbody") {
                val = this.extractFromJsonPath(state.body, ext.jsonPath);
            }
            else if (ext.target === "resheader") {
                val = state.headers?.[ext.jsonPath.toLowerCase()];
            }
            else if (ext.target === "cookie") {
                const cookies = state.headers?.["set-cookie"];
                if (Array.isArray(cookies)) {
                    const match = cookies.find((c) => c.startsWith(`${ext.jsonPath}=`));
                    if (match)
                        val = match.split("=")[1].split(";")[0];
                }
                else if (typeof cookies === "string") {
                    const match = cookies
                        .split(",")
                        .find((c) => c.trim().startsWith(`${ext.jsonPath}=`));
                    if (match)
                        val = match.split("=")[1].split(";")[0];
                }
            }
            if (val === undefined) {
                let debugBody = "";
                try {
                    debugBody =
                        typeof state.body === "object"
                            ? JSON.stringify(state.body)
                            : String(state.body);
                }
                catch {
                    debugBody = "Unparseable Body";
                }
                const shortBody = debugBody.length > 250
                    ? debugBody.substring(0, 250) + "..."
                    : debugBody;
                throw new Error(`Extraction Failed: Could not find "${ext.jsonPath}" in the API ${ext.target}.\nThe API responded with HTTP ${state.status || "Unknown"}\nActual Body Received: ${shortBody}`);
            }
            if (ext.isGlobal)
                FlowWorker.globalVariables[ext.variableName] = val;
            else
                this.localVariables[ext.variableName] = val;
        }
    }
    emitApiTelemetry(method, url, headers, body) {
        const state = this.api.getState();
        const sharedId = Math.random().toString(36).substr(2, 9);
        const baseUrl = this.config.baseUrl || "http://localhost";
        const cleanUrl = url.startsWith("http")
            ? url
            : `${baseUrl.replace(/\/$/, "")}${url.startsWith("/") ? url : `/${url}`}`;
        let endpointName = url;
        try {
            const urlObj = new URL(cleanUrl);
            endpointName = urlObj.pathname.split("/").pop() || urlObj.pathname;
        }
        catch { }
        let parsedReqBody = body;
        let rawBodyString = null;
        try {
            if (typeof body === "string") {
                parsedReqBody = JSON.parse(body);
                rawBodyString = body;
            }
            else if (body) {
                rawBodyString = JSON.stringify(body);
            }
        }
        catch {
            rawBodyString = typeof body === "string" ? body : null;
        }
        const curlString = this.web.synthesizeCurl(method, cleanUrl, headers || {}, rawBodyString);
        this.emitLog("REST", (state.status || 500) < 400 ? "success" : "error", `${method.toUpperCase()} ${endpointName}`, {
            method: method.toUpperCase(),
            url: cleanUrl,
            requestHeaders: headers,
            requestBody: parsedReqBody,
            responseStatus: state.status,
            responseHeaders: state.headers,
            responseBody: state.body,
            curlString: curlString,
        }, sharedId, this.currentFileName);
        this.broadcast("NETWORK_REQ", {
            id: sharedId,
            method: method.toUpperCase(),
            url: cleanUrl,
            name: endpointName,
            status: state.status,
            curlString: curlString,
            time: new Date().toLocaleTimeString([], {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            }),
            fileName: this.currentFileName,
        });
    }
    async handleReplayRequest(payload) {
        try {
            let parsedHeaders = undefined;
            let parsedBody = undefined;
            try {
                if (payload.headers)
                    parsedHeaders = JSON.parse(payload.headers);
            }
            catch (e) { }
            try {
                if (payload.body)
                    parsedBody = JSON.parse(payload.body);
            }
            catch (e) {
                parsedBody = payload.body;
            }
            const fetchOptions = {
                method: payload.method,
                headers: parsedHeaders,
            };
            if (parsedBody && payload.method !== "GET" && payload.method !== "HEAD") {
                fetchOptions.body =
                    typeof parsedBody === "string"
                        ? parsedBody
                        : JSON.stringify(parsedBody);
            }
            const response = await fetch(payload.url, fetchOptions);
            const status = response.status;
            const text = await response.text();
            let responseBody;
            try {
                responseBody = JSON.parse(text);
            }
            catch {
                responseBody = text;
            }
            this.broadcast("REPLAY_RES", {
                status,
                responseBody,
                fileName: this.currentFileName,
            });
        }
        catch (error) {
            this.broadcast("REPLAY_RES", {
                status: 500,
                responseBody: { error: error.message },
                fileName: this.currentFileName,
            });
        }
    }
    abort() {
        this.isAborted = true;
    }
    async runBatch(filesToProcess) {
        this.config.headless = true;
        this.activeAudioPath = undefined;
        this.isAborted = false;
        for (const filePath of filesToProcess) {
            const content = fs.readFileSync(filePath, "utf8");
            const audioMatch = content.match(/(?:flow\.)?injectAudio\s+["']([^"']+)["']/i);
            if (audioMatch && audioMatch[1]) {
                const rawPath = audioMatch[1];
                const absolutePath = path.resolve(process.cwd(), rawPath);
                if (!fs.existsSync(absolutePath)) {
                    throw new Error(`Pre-launch initialization failed: Audio file not found at ${absolutePath}`);
                }
                this.activeAudioPath = absolutePath;
                break;
            }
        }
        for (const filePath of filesToProcess) {
            if (this.isAborted)
                break;
            const fileStartTime = Date.now();
            try {
                const fileName = path.basename(filePath);
                this.currentFileName = fileName;
                this.localVariables = {};
                this.localBrowserSessions = {};
                this.api.resetState();
                this.dataGen = new data_generators_1.DataGenerators();
                await this.web.initialise(this.activeAudioPath);
                await this.startStreaming();
                await this.setupNetworkInterception();
                const content = fs.readFileSync(filePath, "utf8");
                const hasSessionIntent = content.includes("use session") ||
                    content.includes("use global session");
                if (!hasSessionIntent) {
                    try {
                        const page = this.web.getPage();
                        if (page) {
                            await page
                                .context()
                                .clearCookies()
                                .catch(() => { });
                            await page
                                .evaluate(() => {
                                try {
                                    localStorage.clear();
                                }
                                catch (e) { }
                                try {
                                    sessionStorage.clear();
                                }
                                catch (e) { }
                            })
                                .catch(() => { });
                        }
                    }
                    catch (e) { }
                }
                if (!this.isSilent)
                    console.log(chalk_1.default.blue.bold(`\n[Execution]: Processing file: ${fileName}`));
                this.emitLog("FILE_HEADER", "info", fileName, { filePath });
                const features = new parser_1.Parser(new lexer_1.Lexer(content).tokenise()).parse();
                for (const f of features) {
                    if (this.isAborted)
                        break;
                    if (!this.isSilent)
                        console.log(chalk_1.default.magenta.bold(`  Feature: ${f.name}`));
                    for (const s of f.scenarios) {
                        if (this.isAborted)
                            break;
                        if (!this.isSilent)
                            console.log(chalk_1.default.cyan(`    Scenario: ${s.name}`));
                        this.broadcast("RUN_START", {
                            scenarioName: s.name,
                            fileName: this.currentFileName,
                        });
                        await this.runScenario(s, f.declarations);
                        await this.web
                            .getPage()
                            .waitForLoadState("load", { timeout: 4000 })
                            .catch(() => { });
                        await this.web
                            .getPage()
                            .waitForLoadState("networkidle", { timeout: 4000 })
                            .catch(() => { });
                        await new Promise((resolve) => setTimeout(resolve, 2000));
                    }
                }
                if (this.isAborted)
                    break;
                if (!this.isSilent)
                    console.log(chalk_1.default.gray("\n[Execution]: Finalizing browser actions..."));
                await new Promise((resolve) => setTimeout(resolve, 2000));
                try {
                    const baseName = this.currentFileName.replace(".flow", "");
                    const mockCloudDir = path.join(process.cwd(), ".flowstride", "mock-cloud");
                    if (!fs.existsSync(mockCloudDir))
                        fs.mkdirSync(mockCloudDir, { recursive: true });
                    const targetVideoPath = path.join(mockCloudDir, `${baseName}.webm`);
                    await this.web.shutdown(targetVideoPath);
                    if (!this.isSilent)
                        console.log(chalk_1.default.gray(`      [Cloud Sync]: Video safely encoded and preserved for ${this.currentFileName}`));
                }
                catch (err) { }
                this.broadcast("FILE_COMPLETE", {
                    fileName: this.currentFileName,
                    duration: Date.now() - fileStartTime,
                });
            }
            catch (e) {
                if (this.isAborted)
                    break;
                if (!this.isSilent)
                    console.error(chalk_1.default.red(`\n[Execution]: Failed processing ${this.currentFileName}: ${e.message}`));
                try {
                    const baseName = this.currentFileName.replace(".flow", "");
                    const mockCloudDir = path.join(process.cwd(), ".flowstride", "mock-cloud");
                    if (!fs.existsSync(mockCloudDir))
                        fs.mkdirSync(mockCloudDir, { recursive: true });
                    const targetVideoPath = path.join(mockCloudDir, `${baseName}.webm`);
                    await this.web.shutdown(targetVideoPath);
                    if (!this.isSilent)
                        console.log(chalk_1.default.gray(`      [Cloud Sync]: Video safely encoded and preserved for ${this.currentFileName}`));
                }
                catch (err) { }
                this.broadcast("FILE_FAILED", {
                    fileName: this.currentFileName,
                    duration: Date.now() - fileStartTime,
                    error: e.message,
                });
            }
        }
        if (!this.isSilent && !this.isAborted)
            console.log(chalk_1.default.green("[Execution]: All suites completed successfully."));
    }
    async runScenario(scenario, globalDeclarations = []) {
        for (const step of scenario.steps) {
            if (this.isAborted)
                break;
            const blockName = step.blockDescription.split(" ")[0];
            let blockDesc = step.blockDescription.substring(blockName.length).trim();
            blockDesc = this.resolveTextVariables(blockDesc);
            if (this.dataGen)
                blockDesc = this.dataGen.resolve(blockDesc);
            step.payload = this.resolveTemplateData(step.payload);
            this.currentStepContext = `${blockName} ${blockDesc}`;
            const isOpt = step.payload?.optional;
            const mockSpinner = {
                text: "",
                start() {
                    return this;
                },
                succeed() {
                    return this;
                },
                fail() {
                    return this;
                },
                warn() {
                    return this;
                },
                render() {
                    return this;
                },
            };
            const spinner = this.isSilent
                ? mockSpinner.start()
                : (0, ora_1.default)({
                    text: `${chalk_1.default.blue.bold(blockName)} ${chalk_1.default.white(blockDesc)} ${isOpt ? chalk_1.default.gray("(Optional)") : ""}`,
                    indent: 6,
                }).start();
            this.emitLog("ACTION", "info", `${blockName}: ${blockDesc}`, {
                command: step.action,
                payload: step.payload,
            }, undefined, this.currentFileName);
            this.broadcast("STEP_ADD", {
                id: step.id,
                type: blockName,
                description: blockDesc,
                command: step.action,
                status: "running",
                fileName: this.currentFileName,
            });
            try {
                await this.executeStep(step.action, step.payload, scenario.declarations, globalDeclarations);
                const stepContext = await this.captureStepContext(step.payload);
                spinner.succeed();
                this.broadcast("STEP_UPDATE", {
                    id: step.id,
                    status: "passed",
                    screenshot: stepContext.screenshot,
                    fileName: this.currentFileName,
                });
            }
            catch (e) {
                if (this.isAborted)
                    break;
                const stepContext = await this.captureStepContext(step.payload);
                let strippedDom = "";
                try {
                    const page = this.web.getPage();
                    if (page) {
                        strippedDom = await dom_stripper_1.DOMStripper.getStrippedHTML(page);
                    }
                }
                catch (domErr) {
                    if (!this.isSilent)
                        console.warn(chalk_1.default.yellow(`\n[Warning]: Could not extract stripped DOM: ${domErr}`));
                }
                if (isOpt) {
                    spinner.warn(chalk_1.default.yellow(`[Skipped]: ${blockDesc}`));
                    this.emitLog("ACTION", "info", `Skipped Optional Step: ${blockDesc}`, {
                        reason: "Element not present after full timeout.",
                        strippedDom,
                    }, undefined, this.currentFileName);
                    this.broadcast("STEP_UPDATE", {
                        id: step.id,
                        status: "skipped",
                        screenshot: stepContext.screenshot,
                        fileName: this.currentFileName,
                    });
                    continue;
                }
                const isUIAction = [
                    "click",
                    "type",
                    "forceClick",
                    "forceType",
                    "check",
                    "uncheck",
                    "select",
                    "drag",
                    "set",
                ].includes(step.action);
                const errorString = String(e.message || "");
                const isSelectorError = errorString.includes("Timeout") ||
                    errorString.includes("Ambiguity") ||
                    errorString.includes("intercepted") ||
                    errorString.includes("not found") ||
                    errorString.includes("failed to find");
                if (isUIAction &&
                    isSelectorError &&
                    strippedDom &&
                    step.payload?.selector) {
                    spinner.fail();
                    if (!this.isSilent) {
                        console.log(chalk_1.default.magenta(`\n      > [AI Healing]: Auto-healing broken selectors is a Flowstride Enterprise feature.`));
                        console.log(chalk_1.default.magenta(`      > Visit flowstride.io to upgrade and let AI fix broken tests automatically.\n`));
                    }
                }
                else {
                    spinner.fail();
                }
                const humanReadableError = this.translateError(e, step.action, step.payload);
                this.emitLog("ERROR", "error", humanReadableError, {
                    rawError: e.message,
                    command: step.action,
                    screenshot: stepContext.screenshot,
                    boundingBox: stepContext.boundingBox,
                    strippedDom,
                }, undefined, this.currentFileName);
                this.broadcast("STEP_UPDATE", {
                    id: step.id,
                    status: "failed",
                    screenshot: stepContext.screenshot,
                    fileName: this.currentFileName,
                });
                throw e;
            }
        }
    }
    async waitForPipeline() {
        if (!this.activeAudioPath || !fs.existsSync(this.activeAudioPath)) {
            throw new Error("Wait Error: No active audio file was injected to wait for.");
        }
        try {
            const buffer = Buffer.alloc(44);
            const fileDescriptor = fs.openSync(this.activeAudioPath, "r");
            fs.readSync(fileDescriptor, buffer, 0, 44, 0);
            fs.closeSync(fileDescriptor);
            const byteRate = buffer.readUInt32LE(28);
            const fileSize = fs.statSync(this.activeAudioPath).size;
            const dataSize = fileSize - 44;
            let durationSeconds = dataSize / byteRate;
            if (!durationSeconds ||
                durationSeconds < 0 ||
                !isFinite(durationSeconds)) {
                durationSeconds = 10;
            }
            const waitTimeMs = Math.max(0, Math.ceil(durationSeconds * 1000) - 500);
            if (!this.isSilent)
                console.log(chalk_1.default.gray(`\n      > Detected stream duration: ${durationSeconds.toFixed(1)}s.`));
            if (!this.isSilent)
                console.log(chalk_1.default.gray(`      > Pausing runner for ${waitTimeMs}ms...`));
            await new Promise((resolve) => setTimeout(resolve, waitTimeMs));
            if (!this.isSilent)
                console.log(chalk_1.default.gray(`      > Stream finished. Proceeding immediately to click Stop...`));
        }
        catch (error) {
            throw new Error(`Failed to synchronize media pipeline: ${error.message}`);
        }
    }
    async executeStep(action, payload, localDeclarations = [], globalDeclarations = []) {
        switch (action) {
            case "extract":
                this.processExtractions([
                    {
                        target: payload.target.toLowerCase(),
                        jsonPath: payload.jsonPath,
                        variableName: payload.variableName,
                        isGlobal: payload.isGlobal,
                    },
                ]);
                break;
            case "getOtp":
                if (!this.isSilent) {
                    console.log(chalk_1.default.magenta(`\n      > [Notice]: Automated OTP extraction is a Flowstride Enterprise feature.`));
                    console.log(chalk_1.default.magenta(`      > Visit flowstride.io to start your 60-day free trial (up to 1000 free runs).`));
                    console.log(chalk_1.default.magenta(`      > You can cancel at any time before the 61st day.\n`));
                }
                throw new Error("FlowMail Error: Automated OTP extraction requires Flowstride Enterprise. Visit flowstride.io to start your 60-day free trial.");
            case "plugin":
                if (!this.pluginManager) {
                    throw new Error(`Framework Error: PluginManager is not instantiated.`);
                }
                const alias = payload.pluginAlias;
                const method = payload.pluginMethod;
                let resolvedPath = localDeclarations.find((d) => d.alias === alias)?.path;
                if (!resolvedPath) {
                    resolvedPath = globalDeclarations.find((d) => d.alias === alias)?.path;
                }
                if (!resolvedPath) {
                    throw new Error(`Scoping Error: You tried to use the alias "${alias}" without registering it. Please add 'let ${alias} = "path/to/plugin.ts"' at the top of your scenario or feature.`);
                }
                const cleanPath = resolvedPath
                    .replace(/^['"]|['"]$/g, "")
                    .replace(/\.ts$/, "");
                const executableTarget = `${cleanPath}.${method}`;
                await this.pluginManager.execute(executableTarget, payload.data);
                break;
            case "post":
            case "get":
            case "put":
            case "patch":
            case "delete":
                const verb = action.toLowerCase();
                const baseUrl = this.config.baseUrl || "http://localhost";
                this.lastApiUrl = payload.url.startsWith("http")
                    ? payload.url
                    : `${baseUrl.replace(/\/$/, "")}${payload.url.startsWith("/") ? payload.url : `/${payload.url}`}`;
                if (verb === "get" || verb === "delete") {
                    await this.api[verb](payload.url, payload.headers);
                }
                else {
                    await this.api[verb](payload.url, payload.headers, payload.body);
                }
                this.emitApiTelemetry(verb, payload.url, payload.headers, payload.body);
                this.processExtractions(payload.extract);
                break;
            case "graphql":
                const gqlBaseUrl = this.config.baseUrl || "http://localhost";
                this.lastApiUrl = payload.url.startsWith("http")
                    ? payload.url
                    : `${gqlBaseUrl.replace(/\/$/, "")}${payload.url.startsWith("/") ? payload.url : `/${payload.url}`}`;
                await this.api.graphql(payload.url, payload.headers, payload.body);
                this.emitApiTelemetry("graphql", payload.url, payload.headers, payload.body);
                this.processExtractions(payload.extract);
                break;
            case "autoHeal":
                throw new Error("Error: flow.autoheal is a Flowstride Enterprise feature. Visit flowstride.io to upgrade.");
            case "save":
                if (payload.type === "session") {
                    const stateToSave = await this.web.getState();
                    let apiCookies = [];
                    try {
                        const apiState = this.api.getState();
                        if (apiState &&
                            apiState.headers &&
                            apiState.headers["set-cookie"]) {
                            const rawCookies = apiState.headers["set-cookie"];
                            apiCookies = Array.isArray(rawCookies)
                                ? rawCookies
                                : [rawCookies];
                        }
                    }
                    catch (e) { }
                    let fallbackDomain = undefined;
                    try {
                        if (this.lastApiUrl) {
                            fallbackDomain = new URL(this.lastApiUrl).hostname;
                        }
                    }
                    catch (e) { }
                    const hybridState = {
                        cookies: [...(stateToSave.cookies || []), ...apiCookies],
                        localStorage: stateToSave.localStorage || {},
                        sessionStorage: stateToSave.sessionStorage || {},
                        fallbackDomain,
                    };
                    if (payload.isGlobal) {
                        FlowWorker.globalBrowserSessions[payload.name] = hybridState;
                    }
                    else {
                        this.localBrowserSessions[payload.name] = hybridState;
                    }
                    if (payload.persist) {
                        try {
                            const persistDir = path.join(process.cwd(), ".flowstride", "sessions");
                            if (!fs.existsSync(persistDir)) {
                                fs.mkdirSync(persistDir, { recursive: true });
                            }
                            const persistPath = path.join(persistDir, `${payload.name}.json`);
                            fs.writeFileSync(persistPath, JSON.stringify(hybridState, null, 2), "utf-8");
                        }
                        catch (err) {
                            if (!this.isSilent)
                                console.error(chalk_1.default.yellow(`\n      > [Warning]: Could not persist: ${err.message}`));
                        }
                    }
                }
                break;
            case "use":
                if (payload.type === "session") {
                    let loadedState = payload.isGlobal
                        ? FlowWorker.globalBrowserSessions[payload.name]
                        : this.localBrowserSessions[payload.name];
                    if (!loadedState) {
                        const persistPath = path.join(process.cwd(), ".flowstride", "sessions", `${payload.name}.json`);
                        if (fs.existsSync(persistPath)) {
                            try {
                                const fileData = fs.readFileSync(persistPath, "utf-8");
                                loadedState = JSON.parse(fileData);
                                if (payload.isGlobal) {
                                    FlowWorker.globalBrowserSessions[payload.name] = loadedState;
                                }
                                else {
                                    this.localBrowserSessions[payload.name] = loadedState;
                                }
                            }
                            catch (err) {
                                throw new Error(`State Error: Failed to parse persisted session file for "${payload.name}".`);
                            }
                        }
                    }
                    if (!loadedState)
                        throw new Error(`State Error: The session "${payload.name}" does not exist in memory or on disk.`);
                    await this.web.injectStorage(loadedState.cookies, loadedState.localStorage, loadedState.fallbackDomain);
                }
                break;
            case "open":
                await this.web.navigate(payload.url);
                break;
            case "click":
                await this.web.click(payload.selector, payload.elementType);
                break;
            case "forceClick":
                await this.web.forceClick(payload.selector, payload.elementType);
                break;
            case "type":
                await this.web.type(payload.selector, payload.text, payload.elementType);
                break;
            case "forceType":
                await this.web.forceType(payload.selector, payload.text, payload.elementType);
                break;
            case "passcode":
                await this.web.passcode(payload.selector, payload.text, payload.elementType);
                break;
            case "check":
                await this.web.check(payload.selector, payload.elementType);
                break;
            case "uncheck":
                await this.web.uncheck(payload.selector, payload.elementType);
                break;
            case "upload":
                await this.web.upload(payload.selector, payload.file, payload.elementType);
                break;
            case "set":
                await this.web.set(payload.selector, payload.value, payload.elementType);
                break;
            case "select":
                await this.web.select(payload.option, payload.selector, payload.elementType);
                break;
            case "drag":
                await this.web.drag(payload.source, payload.destination);
                break;
            case "switchTo":
                await this.web.switchTo(payload.target);
                await this.startStreaming();
                break;
            case "acceptDialog":
                await this.web.acceptDialog();
                break;
            case "rejectDialog":
                await this.web.rejectDialog();
                break;
            case "close":
                await this.web.close(payload.selector);
                break;
            case "injectAudio":
                await this.web.injectAudio(payload.file);
                break;
            case "waitForPipeline":
                await this.waitForPipeline();
                break;
            case "expect":
                if (["status", "responsetime", "resbody", "resheader", "cookie"].includes(payload.type)) {
                    const apiState = this.api.getState();
                    if (payload.type === "status") {
                        if (String(apiState.status) !== String(payload.statusCode))
                            throw new Error(`API Assertion Failed: Expected HTTP status ${payload.statusCode}, but got ${apiState.status}`);
                    }
                    else if (payload.type === "responsetime") {
                        if (apiState.responseTime > parseInt(payload.threshold, 10))
                            throw new Error(`API Assertion Failed: Expected response time to be less than ${payload.threshold}ms, but got ${apiState.responseTime}ms`);
                    }
                    else {
                        let actualValue;
                        if (payload.type === "resbody")
                            actualValue = this.extractFromJsonPath(apiState.body, payload.jsonPath);
                        else if (payload.type === "resheader")
                            actualValue = apiState.headers?.[payload.jsonPath.toLowerCase()];
                        else if (payload.type === "cookie") {
                            const cookies = apiState.headers?.["set-cookie"];
                            if (Array.isArray(cookies)) {
                                const match = cookies.find((c) => c.startsWith(`${payload.jsonPath}=`));
                                if (match)
                                    actualValue = match.split("=")[1].split(";")[0];
                            }
                        }
                        for (const assertion of payload.assertions) {
                            const condition = assertion.condition;
                            const rawExpected = assertion.value;
                            const expectedLower = String(rawExpected || "").toLowerCase();
                            if (condition === "type.of" || condition === "format") {
                                let isValid = false;
                                const strActual = String(actualValue);
                                if (expectedLower === "email")
                                    isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strActual);
                                else if (expectedLower === "uuid")
                                    isValid =
                                        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(strActual);
                                else if (expectedLower === "url") {
                                    try {
                                        new URL(strActual);
                                        isValid = true;
                                    }
                                    catch {
                                        isValid = false;
                                    }
                                }
                                else if (expectedLower === "date")
                                    isValid = !isNaN(Date.parse(strActual));
                                else if (expectedLower === "hex")
                                    isValid = /^#?([a-f0-9]{6}|[a-f0-9]{3})$/i.test(strActual);
                                else {
                                    let actualType = typeof actualValue;
                                    if (actualValue === null)
                                        actualType = "null";
                                    else if (Array.isArray(actualValue))
                                        actualType = "array";
                                    isValid = actualType === expectedLower;
                                }
                                if (!isValid)
                                    throw new Error(`API Assertion Failed: Expected "${payload.jsonPath}" to be ${expectedLower}, but got "${actualValue}"`);
                            }
                            else if (condition === "matches") {
                                const regex = new RegExp(rawExpected);
                                if (!regex.test(String(actualValue))) {
                                    throw new Error(`API Assertion Failed: Expected "${payload.jsonPath}" to match regex "${rawExpected}", but got "${String(actualValue)}"`);
                                }
                            }
                            else if (["greaterthan", "lessthan"].includes(condition)) {
                                const numActual = Number(actualValue);
                                const numExpected = Number(rawExpected);
                                if (isNaN(numActual) || isNaN(numExpected))
                                    throw new Error(`API Assertion Failed: Numeric comparison requires valid numbers.`);
                                if (condition === "greaterthan" && !(numActual > numExpected))
                                    throw new Error(`API Assertion Failed: Expected ${numActual} > ${numExpected}`);
                                if (condition === "lessthan" && !(numActual < numExpected))
                                    throw new Error(`API Assertion Failed: Expected ${numActual} < ${numExpected}`);
                            }
                            else if (condition.startsWith("length")) {
                                const len = Array.isArray(actualValue) || typeof actualValue === "string"
                                    ? actualValue.length
                                    : undefined;
                                if (len === undefined)
                                    throw new Error(`API Assertion Failed: "${payload.jsonPath}" has no length.`);
                                const numExpected = Number(rawExpected);
                                if (condition === "length" && len !== numExpected)
                                    throw new Error(`API Assertion Failed: Expected length ${numExpected}, got ${len}`);
                                if (condition === "length.greaterthan" && !(len > numExpected))
                                    throw new Error(`API Assertion Failed: Expected length > ${numExpected}, got ${len}`);
                                if (condition === "length.lessthan" && !(len < numExpected))
                                    throw new Error(`API Assertion Failed: Expected length < ${numExpected}, got ${len}`);
                            }
                            else if (["includes", "does.not.include"].includes(condition)) {
                                const isArrayOrString = Array.isArray(actualValue) || typeof actualValue === "string";
                                if (!isArrayOrString)
                                    throw new Error(`API Assertion Failed: Cannot check inclusion on non-collection type.`);
                                const hasItem = actualValue.includes(rawExpected);
                                if (condition === "includes" && !hasItem)
                                    throw new Error(`API Assertion Failed: Expected inclusion of "${rawExpected}"`);
                                if (condition === "does.not.include" && hasItem)
                                    throw new Error(`API Assertion Failed: Expected exclusion of "${rawExpected}"`);
                            }
                            else if (["has.key", "does.not.have.key"].includes(condition)) {
                                if (typeof actualValue !== "object" || actualValue === null)
                                    throw new Error(`API Assertion Failed: Key check requires object.`);
                                const hasKey = rawExpected in actualValue;
                                if (condition === "has.key" && !hasKey)
                                    throw new Error(`API Assertion Failed: Object missing key "${rawExpected}"`);
                                if (condition === "does.not.have.key" && hasKey)
                                    throw new Error(`API Assertion Failed: Object should not contain key "${rawExpected}"`);
                            }
                            else if (["is.empty", "not.empty"].includes(condition)) {
                                const isEmpty = actualValue === undefined ||
                                    actualValue === null ||
                                    actualValue === "" ||
                                    (Array.isArray(actualValue) && actualValue.length === 0) ||
                                    (typeof actualValue === "object" &&
                                        Object.keys(actualValue).length === 0);
                                const isNegated = condition === "not.empty";
                                const passed = isNegated ? !isEmpty : isEmpty;
                                if (!passed)
                                    throw new Error(`API Assertion Failed: Expected "${payload.jsonPath}" to be ${isNegated ? "not empty" : "empty"}, but got "${actualValue}"`);
                            }
                            else {
                                const isNegated = ["to.not.be", "is.not"].includes(condition);
                                const isToBe = ["to.be", "is"].includes(condition);
                                const knownTypes = [
                                    "string",
                                    "number",
                                    "boolean",
                                    "array",
                                    "object",
                                    "null",
                                    "undefined",
                                ];
                                if (["equals", "contains"].includes(condition) ||
                                    (isToBe && !knownTypes.includes(expectedLower))) {
                                    const strActual = String(actualValue);
                                    const isEquals = condition === "equals" ||
                                        (isToBe && !knownTypes.includes(expectedLower));
                                    if (isEquals) {
                                        const match = strActual === rawExpected;
                                        const passed = isNegated ? !match : match;
                                        if (!passed)
                                            throw new Error(`API Assertion Failed: Expected "${payload.jsonPath}" ${isNegated ? "not to equal" : "to equal"} "${rawExpected}", but got "${strActual}"`);
                                    }
                                    else if (condition === "contains") {
                                        const match = strActual.includes(rawExpected);
                                        if (!match)
                                            throw new Error(`API Assertion Failed: Expected "${strActual}" to contain "${rawExpected}"`);
                                    }
                                }
                                else if (isToBe || isNegated) {
                                    let checkPassed = false;
                                    let actualType = typeof actualValue;
                                    if (actualValue === null)
                                        actualType = "null";
                                    else if (Array.isArray(actualValue))
                                        actualType = "array";
                                    else if (actualValue === undefined)
                                        actualType = "undefined";
                                    checkPassed = isNegated
                                        ? actualType !== expectedLower
                                        : actualType === expectedLower;
                                    if (!checkPassed) {
                                        const expectedStr = isNegated
                                            ? `not to be "${expectedLower}"`
                                            : `to be "${expectedLower}"`;
                                        throw new Error(`API Assertion Failed: Expected "${payload.jsonPath}" ${expectedStr}, but got type "${actualType}".`);
                                    }
                                }
                            }
                        }
                    }
                }
                else if (payload.type === "visible")
                    await this.web.expectVisible(payload.selector, payload.elementType);
                else if (payload.type === "text")
                    await this.web.expectText(payload.selector, payload.fuzzy, payload.elementType);
                else if (payload.type === "value")
                    await this.web.expectValue(payload.selector, payload.text, payload.elementType);
                else if (payload.type === "transcript")
                    await this.web.expectTranscript(payload.text);
                break;
        }
    }
    async setupNetworkInterception() {
        const context = this.web.getPage().context();
        context.on("response", async (response) => {
            const lockedFileName = this.currentFileName;
            const request = response.request();
            const type = request.resourceType();
            if (type !== "fetch" && type !== "xhr")
                return;
            let responseBody = null;
            try {
                const text = await response.text();
                responseBody = JSON.parse(text);
            }
            catch {
                responseBody = "[Body capture failed]";
            }
            let requestBody = null;
            let rawPostData = null;
            try {
                rawPostData = request.postData();
                if (rawPostData)
                    requestBody = JSON.parse(rawPostData);
            }
            catch {
                requestBody = "[Request body capture failed]";
            }
            const sharedId = Math.random().toString(36).substr(2, 9);
            const urlObj = new URL(request.url());
            const endpointName = urlObj.pathname.split("/").pop() || urlObj.pathname;
            const curlString = this.web.synthesizeCurl(request.method(), request.url(), request.headers(), rawPostData);
            this.emitLog("REST", response.status() < 400 ? "success" : "error", `${request.method()} ${endpointName}`, {
                method: request.method(),
                url: request.url(),
                requestHeaders: request.headers(),
                requestBody: requestBody,
                responseStatus: response.status(),
                responseHeaders: response.headers(),
                responseBody: responseBody,
                curlString: curlString,
            }, sharedId, lockedFileName);
            this.broadcast("NETWORK_REQ", {
                id: sharedId,
                method: request.method(),
                url: request.url(),
                name: endpointName,
                status: response.status(),
                curlString: curlString,
                time: new Date().toLocaleTimeString([], {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                }),
                fileName: lockedFileName,
            });
        });
    }
    async startStreaming() {
        const page = this.web.getPage();
        if (this.currentCdpSession) {
            await this.currentCdpSession.detach().catch(() => { });
        }
        this.currentCdpSession = await page.context().newCDPSession(page);
        await this.currentCdpSession.send("Page.startScreencast", {
            format: "jpeg",
            quality: 60,
        });
        this.currentCdpSession.on("Page.screencastFrame", ({ data, sessionId }) => {
            this.broadcast("BROWSER_FRAME", {
                base64: data,
                fileName: this.currentFileName,
            });
            this.currentCdpSession
                .send("Page.screencastFrameAck", { sessionId })
                .catch(() => { });
        });
    }
    async shutdown() {
        try {
            await this.web.shutdown();
        }
        catch (e) { }
    }
}
exports.FlowWorker = FlowWorker;

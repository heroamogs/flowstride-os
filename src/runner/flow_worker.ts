import { commandSecrets, runtimeFailure } from '../reporting/runtime_failure';
import { assertionText, commandLabel, failedAssertion, unexecutedAssertion, type AssertionResult } from '../reporting/assertion_result';
import { validateExpectationType, validateApiAssertions, validateResponseTimeThreshold } from '../parser/assertion_contract';
import { nativeStepTimeout } from '../native/deadline';
import { NativeRuntime } from '../native/runtime';
import { withDeadline } from '../ci/deadline';
import { buildReplayRequest, ReplayRequestError } from '../utils/replayRequest';
import { flowIdentity, videoFileName, projectPath } from '../utils/projectPaths';
import { redactWorkerPayload, redactText } from '../security/redaction';
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import ora from "ora";
import { EventEmitter } from "events";
import { WebAdapter } from "../adapters/web/playwright";
import { ApiAdapter } from "../adapters/api/undici";
import { SessionManager } from "../sessions/manager";
import { FlowstrideConfig } from "../types";
import { Lexer } from "../parser/lexer";
import { Parser, ScenarioNode, DeclarationNode } from "../parser/parser";
import { DataGenerators } from "./data_generators";
import { PluginManager } from "./plugin_manager";
import { DOMStripper } from "./dom_stripper";

type LogType =
  | "ACTION"
  | "REST"
  | "GRAPHQL"
  | "ASSERT"
  | "CONSOLE"
  | "ERROR"
  | "FILE_HEADER";

export interface SmartSelectorToken {
  rawTarget: string;
  relation?: "near" | "above" | "under" | "below" | "leftOf" | "rightOf";
  anchor?: string;
  inside?: string;
  index?: number;
  isRawCSS?: boolean;
}

export class FlowWorker extends EventEmitter {
  public static readonly nativeBrowserProtocol = 2;
  public static readonly nativeAssertionProtocol = 1;
  private isSilent = process.env.FLOWSTRIDE_PARALLEL === "true";
  private isAborted = false;
  private bailTriggered = false;
  private isDebugHalted = false;
  private native: NativeRuntime;
  private currentAssertion?: AssertionResult;
  private commandSecretValues: string[] = [];
  private batchPassed = true;
  private attempt = 1;
  private maxAttempts = 1;
  private fallbackStream?: NodeJS.Timeout;
  private interceptedContexts = new WeakSet<object>();

  private currentStepContext: string = "Initializing...";
  private currentFileName: string = "System";
  private activeAudioPath: string | undefined = undefined;

  private currentCdpSession: any = null;
  private dataGen: DataGenerators | null = null;

  private localVariables: Record<string, any> = {};
  private localBrowserSessions: Record<string, any> = {};

  private static globalVariables: Record<string, any> = {};
  private static globalBrowserSessions: Record<string, any> = {};

  private lastApiUrl: string = "";

  constructor(
    private config: FlowstrideConfig,
    private web: WebAdapter,
    private api: ApiAdapter,
    private store: any,
    private sessions: SessionManager,
    private pluginManager?: PluginManager,
  ) {
    super();
    this.native = new NativeRuntime(web, config);
    this.web.onPageChanged = async () => { await this.startStreaming(); await this.setupNetworkInterception(); };
  }

  private broadcast(type: string, payload: any) {
    if (["STEP_ADD","STEP_UPDATE","LOG_EVENT"].includes(type)) payload = { ...payload, attempt: this.attempt, profile: this.web.activeProfile || "default" };
    this.emit('worker_event', { type, payload: redactWorkerPayload(type, payload, this.secretValues(), this.config.ci === false) });
  }

  private secretValues(): string[] {
    return [...this.commandSecretValues, this.config.machineToken || '', ...(this.dataGen?.sensitiveValues?.() || []), ...Object.entries(process.env).filter(([key]) => /password|token|secret|api.?key/i.test(key)).map(([,value]) => String(value)), ...Object.entries(this.localVariables).filter(([key]) => /password|passcode|token|secret|otp|api.?key/i.test(key)).map(([,value]) => String(value))];
  }

  private assertionForStep(step: any): AssertionResult | undefined {
    if (!this.currentAssertion) return;
    const value = { ...this.currentAssertion, sourceFile:this.currentFileName, sourceLine:step.line, profile:this.web.activeProfile || 'default' };
    return redactWorkerPayload('STEP_UPDATE', { assertion:value }, this.secretValues()).assertion;
  }

  private printAssertion(value: AssertionResult | undefined) {
    if (!this.isSilent && value) console.log(assertionText(value).split('\n').map(line=>'        '+line).join('\n'));
  }

  private emitLog(
    type: LogType,
    status: "success" | "error" | "info" | "warning",
    summary: string,
    details: any,
    customId?: string,
    overrideFileName?: string,
  ) {
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

  private translateError(error: any, action: string, payload: any): string {
    return runtimeFailure(action,payload,error,{file:this.currentFileName,profile:this.web.activeProfile || 'default',timeout:this.config.timeout});
  }

  private async captureStepContext(
    payload: any,
  ): Promise<{ screenshot?: string; boundingBox?: any }> {
    let page: any;
    try { page = this.web.getPage(); } catch { return {}; }
    const context: { screenshot?: string; boundingBox?: any } = {};

    try {
      const buffer = await page.screenshot({ type: "jpeg", quality: 50 });
      context.screenshot = buffer.toString("base64");
    } catch (e) {}

    if (payload && payload.selector) {
      try {
        const box = await page
          .locator(payload.selector)
          .boundingBox({ timeout: 500 });
        if (box) {
          context.boundingBox = box;
        }
      } catch (e) {}
    }

    return context;
  }

  private resolveTextVariables(text: string | any): string | any {
    if (typeof text !== "string") {
      return text;
    }

    let resolved = text;

    resolved = resolved.replace(
      /\{\{env\.([a-zA-Z0-9_]+)\}\}/g,
      (_, varName) => {
        const val = process.env[varName];
        if (val === undefined) {
          throw new Error(
            `Environment Error: The variable "{{env.${varName}}}" is undefined. Make sure it is set in your OS or .env file.`,
          );
        }
        return val;
      },
    );

    resolved = resolved.replace(/@global\[(.*?)\]/g, (_, varName) => {
      const val = FlowWorker.globalVariables[varName];
      if (val === undefined)
        throw new Error(
          `State Error: Global variable "@global[${varName}]" is undefined.`,
        );
      return val;
    });

    resolved = resolved.replace(/@([a-zA-Z0-9_]+)/g, (match, varName) => {
      const val = this.localVariables[varName];
      return val !== undefined ? val : match;
    });
    return resolved;
  }

  private resolveTemplateData(obj: any): any {
    if (typeof obj === "string") {
      let text = this.resolveTextVariables(obj);
      if (this.dataGen) text = this.dataGen.resolve(text);
      return text;
    }
    if (Array.isArray(obj))
      return obj.map((item) => this.resolveTemplateData(item));
    if (obj !== null && typeof obj === "object") {
      const resolvedObj: any = {};
      for (const [key, value] of Object.entries(obj)) {
        resolvedObj[key] = this.resolveTemplateData(value);
      }
      return resolvedObj;
    }
    return obj;
  }

  private extractFromJsonPath(obj: any, path: string): any {
    if (!obj) return undefined;
    if (!path) return obj;
    const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
    let current = obj;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return current;
  }

  private processExtractions(extracts: any[]) {
    if (!extracts || extracts.length === 0) return;
    const state = this.api.getState();

    for (const ext of extracts) {
      let val;
      if (ext.target === "resBody") {
        val = this.extractFromJsonPath(state.body, ext.jsonPath);
      } else if (ext.target === "resHeader") {
        val = state.headers?.[(ext.jsonPath || "").toLowerCase()];
      } else if (ext.target === "cookie") {
        const cookies = state.headers?.["set-cookie"];
        if (Array.isArray(cookies)) {
          const match = cookies.find((c) => c.startsWith(`${ext.jsonPath}=`));
          if (match) val = match.split("=")[1].split(";")[0];
        } else if (typeof cookies === "string") {
          const match = cookies
            .split(",")
            .find((c) => c.trim().startsWith(`${ext.jsonPath}=`));
          if (match) val = match.split("=")[1].split(";")[0];
        }
      }

      if (val === undefined) {
        let debugBody = "";
        try {
          debugBody =
            typeof state.body === "object"
              ? JSON.stringify(state.body)
              : String(state.body);
        } catch {
          debugBody = "Unparseable Body";
        }
        const shortBody =
          debugBody.length > 250
            ? debugBody.substring(0, 250) + "..."
            : debugBody;
        throw new Error(
          `Extraction Failed: Could not find "${ext.jsonPath}" in the API ${ext.target}.\nThe API responded with HTTP ${state.status || "Unknown"}\nActual Body Received: ${shortBody}`,
        );
      }

      if (ext.isGlobal) FlowWorker.globalVariables[ext.variableName] = val;
      else this.localVariables[ext.variableName] = val;
    }
  }

  private emitApiTelemetry(
    method: string,
    url: string,
    headers: any,
    body: any,
  ) {
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
    } catch {}

    let parsedReqBody = body;
    let rawBodyString = null;
    try {
      if (typeof body === "string") {
        parsedReqBody = JSON.parse(body);
        rawBodyString = body;
      } else if (body) {
        rawBodyString = JSON.stringify(body);
      }
    } catch {
      rawBodyString = typeof body === "string" ? body : null;
    }

    let formattedHeaders: Record<string, string> = {};
    if (Array.isArray(headers)) {
      headers.forEach((h: any) => {
        if (h && h.key) formattedHeaders[h.key] = h.value;
      });
    } else if (headers && typeof headers === "object") {
      formattedHeaders = headers;
    }

    const curlString = this.web.synthesizeCurl(
      method,
      cleanUrl,
      formattedHeaders,
      rawBodyString,
    );

    this.emitLog(
      "REST",
      (state.status || 500) < 400 ? "success" : "error",
      `${method.toUpperCase()} ${endpointName}`,
      {
        method: method.toUpperCase(),
        url: cleanUrl,
        requestHeaders: formattedHeaders,
        requestBody: parsedReqBody,
        rawReplayRequest: { method: method.toUpperCase(), url: cleanUrl, headers: formattedHeaders, body: rawBodyString },
        responseStatus: state.status,
        responseHeaders: state.headers,
        responseBody: state.body,
        curlString: curlString,
      },
      sharedId,
      this.currentFileName,
    );

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

  public async handleReplayRequest(payload: any) {
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId : undefined;
    try {
      const { url, options } = buildReplayRequest(payload);
      options.signal = AbortSignal.timeout(this.config.timeout || 30000);
      const response = await fetch(url, options);
      const text = await response.text();
      let responseBody;
      try { responseBody = JSON.parse(text); } catch { responseBody = text; }
      this.broadcast('REPLAY_RES', {
        status: response.status, responseBody, error: null, requestId,
        fileName: this.currentFileName,
      });
    } catch (error: any) {
      const code = error instanceof ReplayRequestError ? 'REPLAY_INVALID_REQUEST'
        : error?.name === 'TimeoutError' ? 'REPLAY_TIMEOUT' : 'REPLAY_NETWORK_ERROR';
      const message = redactText(String(error?.message || 'Replay request failed'), [this.config.machineToken || '']);
      this.broadcast('REPLAY_RES', {
        status: null, error: code, requestId,
        responseBody: { error: message, code }, fileName: this.currentFileName,
      });
    }
  }

  public abort(): void {
    this.isAborted = true;
  }

  public async runBatch(filesToProcess: string[]): Promise<boolean> {
    this.batchPassed = filesToProcess.length > 0;
    const isCliHeadless = process.argv.includes("--headless");

    if (isCliHeadless) {
      this.config.headless = true;
    } else if (this.config.headless === undefined) {
      this.config.headless = false;
    }

    this.activeAudioPath = undefined;
    this.isAborted = false;
    this.bailTriggered = false;
    this.isDebugHalted = false;

    const sigintHandler = async () => {
      if (this.config.ci) { this.abort(); return; }
      if (!this.isSilent) {
        console.log(
          chalk.yellow(
            "\n[Flowstride]: Process interrupted. Gracefully shutting down...",
          ),
        );
      }
      this.abort();
      this.broadcast("SERVER_SHUTDOWN", { message: "Terminal closed." });
      try {
        await this.web.shutdown();
      } catch (e) {}
      if (!this.config.ci) process.exit(this.isAborted ? 130 : process.exitCode || 0);
    };

    process.once("SIGINT", sigintHandler);

    try {
      for (const filePath of filesToProcess) {
        const content = fs.readFileSync(filePath, "utf8");
        const audioMatch = content.match(
          /(?:flow\.)?injectAudio\s+["']([^"']+)["']/i,
        );
        if (audioMatch && audioMatch[1]) {
          const rawPath = audioMatch[1];
          const absolutePath = projectPath(process.cwd(), rawPath);
          if (!fs.existsSync(absolutePath)) {
            throw new Error(
              `Pre-launch initialization failed: Audio file not found at ${absolutePath}`,
            );
          }
          this.activeAudioPath = absolutePath;
          break;
        }
      }

      for (const filePath of filesToProcess) {
        if (this.isAborted || this.isDebugHalted || this.bailTriggered) break;

        const fileStartTime = Date.now();
        try {
          const fileName = flowIdentity(filePath, this.config.flowRoot);
          this.currentFileName = fileName;
          this.config.testFile = fileName;

          this.localVariables = {};
          this.localBrowserSessions = {};
          this.api.resetState();
          this.dataGen = new DataGenerators();

          await this.native.dispose();
          await this.web.initialise(this.activeAudioPath);
          if (typeof this.web.getBrowserInfo === 'function') {
            const browser = this.web.getBrowserInfo();
            console.log(`[Browser]: ${browser.engine} ${browser.version}; ${browser.headless ? 'headless' : 'headed'}; ${fileName}`);
            this.broadcast('BROWSER_INFO', { ...browser, fileName });
          }
          await this.startStreaming();
          await this.setupNetworkInterception();

          const content = fs.readFileSync(filePath, "utf8");

          const hasSessionIntent =
            content.includes("use session") ||
            content.includes("use global session");
          if (!hasSessionIntent) {
            try {
              const page = this.web.getPage();
              if (page) {
                await page
                  .context()
                  .clearCookies()
                  .catch(() => {});
                await page
                  .evaluate(() => {
                    try {
                      localStorage.clear();
                    } catch (e) {}
                    try {
                      sessionStorage.clear();
                    } catch (e) {}
                  })
                  .catch(() => {});
              }
            } catch (e) {}
          }

          if (!this.isSilent)
            console.log(
              chalk.blue.bold(`\n[Execution]: Processing file: ${fileName}`),
            );
          this.emitLog("FILE_HEADER", "info", fileName, { filePath });

          const features = new Parser(new Lexer(content).tokenise()).parse();

          const hasOnlyMode = features.some((f) =>
            f.scenarios.some((s) => s.isOnly),
          );

          if (hasOnlyMode) {
            if (!this.isSilent) {
              console.log(
                chalk.yellow(
                  `      > [Debug Mode]: 'only.Scenario' detected. Operating in Ghost Mode.`,
                ),
              );
            }
            features.forEach((f) => {
              f.scenarios = f.scenarios.filter((s) => s.isOnly);
            });
          }

          for (const f of features) {
            if (this.isAborted || this.isDebugHalted || this.bailTriggered) break;
            if (f.scenarios.length === 0) continue;

            if (!this.isSilent)
              console.log(chalk.magenta.bold(`  Feature: ${f.name}`));
            for (const s of f.scenarios) {
              if (this.isAborted || this.isDebugHalted || this.bailTriggered) break;

              if (!this.isSilent)
                console.log(chalk.cyan(`    Scenario: ${s.name}`));

              this.broadcast("RUN_START", {
                scenarioName: s.name,
                fileName: this.currentFileName,
              });

              if (!await this.runScenarioWithRetries(s, f.declarations)) this.batchPassed = false;

              if (this.isDebugHalted || this.bailTriggered) break;

              await this.web
                .getPage()
                .waitForLoadState("load", { timeout: 4000 })
                .catch(() => {});
              await this.web
                .getPage()
                .waitForLoadState("networkidle", { timeout: 4000 })
                .catch(() => {});
              if (!this.config.ci) await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          }

          if (this.isAborted) break;

          if (!this.isSilent)
            console.log(
              chalk.gray("\n[Execution]: Finalizing browser actions..."),
            );
          if (!this.config.ci) await new Promise((resolve) => setTimeout(resolve, 2000));

          try {
            const baseName = videoFileName(this.currentFileName).replace(/\.webm$/, '');
            const mockCloudDir = path.join(
              process.cwd(),
              ".flowstride",
              "mock-cloud",
            );
            if (!fs.existsSync(mockCloudDir))
              fs.mkdirSync(mockCloudDir, { recursive: true });

            const targetVideoPath = path.join(mockCloudDir, `${baseName}.webm`);

            for (const message of this.web.pageErrors || []) this.broadcast('BROWSER_ERROR', { message, fileName: this.currentFileName });
            await this.native.dispose();
            await this.web.shutdown(targetVideoPath);
            if (!this.isSilent)
              console.log(
                chalk.gray(
                  `      [Cloud Sync]: Video safely encoded and preserved for ${this.currentFileName}`,
                ),
              );
          } catch (err) {}

          this.broadcast("FILE_COMPLETE", {
            fileName: this.currentFileName,
            duration: Date.now() - fileStartTime,
          });
        } catch (e: any) {
          this.batchPassed = false;
          if (this.isAborted) break;

          if (!this.isSilent)
            console.error(
              chalk.red(
                `\n[Execution]: Failed processing ${this.currentFileName}: ${redactText(runtimeFailure("file.setup",{file:this.currentFileName},e,{file:this.currentFileName}),this.secretValues())}`,
              ),
            );

          try {
            const baseName = videoFileName(this.currentFileName).replace(/\.webm$/, '');
            const mockCloudDir = path.join(
              process.cwd(),
              ".flowstride",
              "mock-cloud",
            );
            if (!fs.existsSync(mockCloudDir))
              fs.mkdirSync(mockCloudDir, { recursive: true });

            const targetVideoPath = path.join(mockCloudDir, `${baseName}.webm`);

            for (const message of this.web.pageErrors || []) this.broadcast('BROWSER_ERROR', { message, fileName: this.currentFileName });
            await this.native.dispose();
            await this.web.shutdown(targetVideoPath);
            if (!this.isSilent)
              console.log(
                chalk.gray(
                  `      [Cloud Sync]: Video safely encoded and preserved for ${this.currentFileName}`,
                ),
              );
          } catch (err) {}

          this.broadcast("FILE_FAILED", {
            fileName: this.currentFileName,
            duration: Date.now() - fileStartTime,
            error: runtimeFailure("file.setup",{file:this.currentFileName},e,{file:this.currentFileName}),
          });
        }
      }

      if (!this.config.ci && !this.isSilent && !this.isAborted) {
        if (this.isDebugHalted) {
          console.log(
            chalk.cyan("\n[Execution]: Test suite halted by debug flag."),
          );
        } else {
          console.log(
            this.batchPassed ? chalk.green("\n[Execution]: All suites completed successfully.") : chalk.red("\n[Execution]: Test suite failed. Review the diagnostics above."),
          );
        }
      }
    } finally {
      if (this.config.ci && this.isAborted) {
        try {
          const directory = path.join(process.cwd(), '.flowstride', 'artifacts');
          fs.mkdirSync(directory, { recursive: true });
          await this.native.dispose();
          await this.web.shutdown(path.join(directory, videoFileName(this.currentFileName)));
        } catch (error: any) { this.broadcast('WORKER_ERROR', { message: error.message }); }
      }
      process.removeListener("SIGINT", sigintHandler);
    }
    return this.batchPassed && !this.isAborted && !this.isDebugHalted;
  }

  private async runScenarioWithRetries(scenario: ScenarioNode, declarations: DeclarationNode[]) {
    this.maxAttempts = (this.config.retries || 0) + 1;
    const baseline = this.maxAttempts > 1 ? await this.web.checkpointProfiles() : undefined;
    const variables = this.maxAttempts > 1 ? structuredClone(this.localVariables) : {}, sessions = this.maxAttempts > 1 ? structuredClone(this.localBrowserSessions) : {};
    const globals = this.maxAttempts > 1 ? structuredClone(FlowWorker.globalVariables) : {}, globalSessions = this.maxAttempts > 1 ? structuredClone(FlowWorker.globalBrowserSessions) : {};
    const storeState = this.maxAttempts > 1 ? structuredClone(this.store.getAll?.()) : undefined;
    const apiState = this.maxAttempts > 1 ? this.api.checkpointState?.() : undefined;
    let finalPassed = false;
    for (this.attempt = 1; this.attempt <= this.maxAttempts; this.attempt++) {
      if (this.isAborted || this.isDebugHalted) break;
      if (this.attempt > 1) {
        await this.native.dispose(); if (apiState) this.api.restoreState(apiState); else this.api.resetState();
        this.localVariables = structuredClone(variables); this.localBrowserSessions = structuredClone(sessions);
        FlowWorker.globalVariables = structuredClone(globals); FlowWorker.globalBrowserSessions = structuredClone(globalSessions);
        if (storeState) { this.store.clear(); for (const [key,value] of Object.entries(structuredClone(storeState))) this.store.set(key,value); }
        await this.web.restoreProfiles(baseline);
      }
      const started = Date.now();
      this.broadcast('SCENARIO_ATTEMPT', { fileName: this.currentFileName, scenario: scenario.name, attempt: this.attempt });
      const errorIndex = this.web.pageErrors?.length || 0;
      const completed = await this.runScenario(structuredClone(scenario), declarations);
      const browserErrors = this.web.pageErrors?.slice(errorIndex) || [];
      const passed = completed && (this.config.browserErrors === 'record' || !browserErrors.length);
      if (this.config.browserErrors !== 'record') for (const message of browserErrors) {
        const error = runtimeFailure('browser.pageError',{},new Error(message),{file:this.currentFileName,profile:this.web.activeProfile || 'default'});
        this.emitLog('ERROR','error',error,{rawError:error,command:'browser.pageError'},undefined,this.currentFileName);
        if (!this.isSilent) console.error(redactText(error,this.secretValues()));
      }
      this.broadcast('SCENARIO_RESULT', { fileName: this.currentFileName, scenario: scenario.name, attempt: this.attempt, status: this.isAborted ? 'interrupted' : passed ? 'passed' : 'failed', flaky: passed && this.attempt > 1, browserErrors, duration: Date.now() - started });
      finalPassed = passed && !(this.config.failOnFlaky && this.attempt > 1);
      if (passed || this.isAborted || this.isDebugHalted) break;
      if (this.attempt < this.maxAttempts) this.web.pageErrors?.splice(errorIndex);
    }
    this.attempt = 1; this.maxAttempts = 1;
    return finalPassed;
  }

  private async runScenario(
    scenario: ScenarioNode,
    globalDeclarations: DeclarationNode[] = [],
  ) {
    let hasScenarioFailed = false;
    for (const originalStep of scenario.steps) {
      const step = structuredClone(originalStep);
      this.currentAssertion = undefined;
      this.commandSecretValues = [];
      if (this.isAborted) break;

      const blockName = step.blockDescription.split(" ")[0];
      let blockDesc = step.blockDescription.substring(blockName.length).trim();

      const stepLabel = commandLabel(step.action, step.payload);
      if (hasScenarioFailed) {
        const assertion=unexecutedAssertion(step.action,step.payload);
        this.broadcast('STEP_ADD',{id:step.id,type:blockName,description:blockDesc,command:step.action,commandLabel:stepLabel,sourceLine:step.line,status:'not_tested',fileName:this.currentFileName});
        this.broadcast('STEP_UPDATE',{id:step.id,status:'not_tested',assertion,error:null,commandLabel:stepLabel,sourceLine:step.line,fileName:this.currentFileName});
        continue;
      }

      let resolutionError: unknown;
      try {
      blockDesc = this.resolveTextVariables(blockDesc);
      if (this.dataGen) blockDesc = this.dataGen.resolve(blockDesc);

      step.payload = this.resolveTemplateData(step.payload);

      } catch (error) { resolutionError = error; }
      this.commandSecretValues = commandSecrets(step.action,step.payload);

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
        : ora({
            text: `${chalk.blue.bold(blockName)} ${chalk.white(blockDesc)} ${isOpt ? chalk.gray("(Optional)") : ""}`,
            indent: 6,
          }).start();

      this.emitLog(
        "ACTION",
        "info",
        `${blockName}: ${blockDesc}`,
        {
          command: step.action,
          commandLabel: stepLabel,
          sourceLine: step.line,
          payload: step.payload,
        },
        undefined,
        this.currentFileName,
      );

      this.broadcast("STEP_ADD", {
        id: step.id,
        type: blockName as any,
        description: blockDesc,
        command: step.action,
          commandLabel: stepLabel,
          sourceLine: step.line,
        status: "running",
        error: null, assertion: null,
        fileName: this.currentFileName,
      });

      const stepStarted = Date.now();
      try {
        if (resolutionError) throw resolutionError;
        await this.executeStep(
          step.action,
          step.payload,
          scenario.declarations,
          globalDeclarations,
        );

        const stepContext = await this.captureStepContext(step.payload);
        const domSnapshot = await this.native.captureDOM(step.id).catch(() => undefined);
        spinner.succeed();
        const assertion=this.assertionForStep(step);
        this.printAssertion(assertion);
        this.broadcast("STEP_UPDATE", {
          id: step.id,
          status: "passed",
          error: null,
          assertion,
          screenshot: stepContext.screenshot,
          domSnapshot,
          fileName: this.currentFileName,
        });

        if (step.isStop) {
          if (!this.isSilent) {
            console.log(
              chalk.cyan(
                `      > [Execution]: Debug stop triggered. Halting global execution.`,
              ),
            );
          }
          this.isDebugHalted = true;
          break;
        }
      } catch (e: any) {
        if (this.isAborted) break;
        const assertion=this.assertionForStep(step);

        const stepContext = await this.captureStepContext(step.payload);
        const domSnapshot = await this.native.captureDOM(step.id).catch(() => undefined);

        let strippedDom = "";
        try {
          const page = this.web.getPage();
          if (page) {
            strippedDom = await DOMStripper.getStrippedHTML(page);
          }
        } catch (domErr) {
          if (!this.isSilent)
            console.warn(
              chalk.yellow(
                `\n[Warning]: Could not extract stripped DOM: ${domErr}`,
              ),
            );
        }

        if (isOpt) {
          spinner.warn(chalk.yellow(`[Skipped]: ${blockDesc}`));
          this.emitLog(
            "ACTION",
            "info",
            `Skipped Optional Step: ${blockDesc}`,
            {
              reason: runtimeFailure(stepLabel,step.payload,e,{file:this.currentFileName,line:step.line}),
              strippedDom,
            },
            undefined,
            this.currentFileName,
          );
          this.broadcast("STEP_UPDATE", {
            id: step.id,
            status: "skipped",
            error:runtimeFailure(stepLabel,step.payload,e,{file:this.currentFileName,line:step.line}),
            assertion,
            screenshot: stepContext.screenshot,
            domSnapshot,
            fileName: this.currentFileName,
          });
          continue;
        }

        const isUIAction = [
          "click",
          "hover",
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
        const isSelectorError =
          errorString.includes("Timeout") ||
          errorString.includes("Ambiguity") ||
          errorString.includes("intercepted") ||
          errorString.includes("not found") ||
          errorString.includes("failed to find");

        if (
          isUIAction &&
          isSelectorError &&
          strippedDom &&
          step.payload?.selector
        ) {
          spinner.fail();
          if (!this.isSilent) {
            console.log(
              chalk.magenta(
                `\n      > [AI Healing]: Auto-healing broken selectors is a Flowstride Enterprise feature.`,
              ),
            );
            console.log(
              chalk.magenta(
                `      > Visit flowstride.io to upgrade and let AI fix broken tests automatically.\n`,
              ),
            );
          }
        } else {
          spinner.fail();
        }

        const humanReadableError = assertion ? assertionText(assertion) : runtimeFailure(stepLabel,step.payload,e,{file:this.currentFileName,line:step.line,profile:this.web.activeProfile || "default",timeout:this.config.timeout,elapsed:Date.now()-stepStarted});
        this.printAssertion(assertion);
        if (!this.isSilent && !assertion) console.error('      '+redactText(String(humanReadableError),this.secretValues()).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,''));

        this.emitLog(
          "ERROR",
          "error",
          humanReadableError,
          {
            rawError: humanReadableError,
            stepId: step.id,
            assertion,
            command: step.action,
          commandLabel: stepLabel,
          sourceLine: step.line,
            screenshot: stepContext.screenshot,
            boundingBox: stepContext.boundingBox,
            strippedDom,
          },
          undefined,
          this.currentFileName,
        );

        this.broadcast("STEP_UPDATE", {
          id: step.id,
          status: "failed",
          error: humanReadableError,
          assertion,
          screenshot: stepContext.screenshot,
          domSnapshot,
          fileName: this.currentFileName,
        });
        hasScenarioFailed = true;
        if (this.config.bail && this.attempt >= this.maxAttempts && !this.bailTriggered) {
          this.bailTriggered = true;
          this.broadcast('BAIL', { fileName: this.currentFileName, id: step.id });
        }
      }
    }
    return !hasScenarioFailed;
  }

  private async waitForPipeline(): Promise<void> {
    if (!this.activeAudioPath || !fs.existsSync(this.activeAudioPath)) {
      throw new Error(
        "Wait Error: No active audio file was injected to wait for.",
      );
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

      if (
        !durationSeconds ||
        durationSeconds < 0 ||
        !isFinite(durationSeconds)
      ) {
        durationSeconds = 10;
      }

      const waitTimeMs = Math.max(0, Math.ceil(durationSeconds * 1000) - 500);

      if (!this.isSilent)
        console.log(
          chalk.gray(
            `\n      > Detected stream duration: ${durationSeconds.toFixed(1)}s.`,
          ),
        );
      if (!this.isSilent)
        console.log(
          chalk.gray(`      > Pausing runner for ${waitTimeMs}ms...`),
        );

      await new Promise((resolve) => setTimeout(resolve, waitTimeMs));

      if (!this.isSilent)
        console.log(
          chalk.gray(
            `      > Stream finished. Proceeding immediately to click Stop...`,
          ),
        );
    } catch (error: any) {
      throw new Error(`Failed to synchronize media pipeline: ${error.message}`);
    }
  }

  private async executeStep(
    action: string,
    payload: any,
    localDeclarations: DeclarationNode[] = [],
    globalDeclarations: DeclarationNode[] = [],
  ) {
    if (payload && payload.selector === "smart-burger-fallback") {
      payload.selector = [
        'button[aria-label*="menu" i]',
        '[aria-label*="menu" i]',
        '[title*="menu" i]',
        ".bm-burger-button",
        '[class*="hamburger" i]',
        '[class*="burger" i]',
        '[id*="hamburger" i]',
        '[id*="burger" i]',
      ].join(", ");
    }

    if (action === 'expect') validateExpectationType(payload?.type);

    switch (action) {
      case 'native': {
        const timeout = nativeStepTimeout(payload.pluginMethod, payload.data, this.config.timeout);
        let result: unknown;
        try {
          result = await withDeadline(this.native.execute(payload.pluginMethod, payload.data), timeout);
          this.currentAssertion = this.native.lastAssertion;
        } catch (error: any) {
          const fallback = unexecutedAssertion('native',payload,'The assertion could not execute.');
          if (fallback) { fallback.status='failed';fallback.checks.push({key:'execution',label:'Assertion execution',status:'failed',reason:String(error.message||error)}); }
          this.currentAssertion = failedAssertion(error.assertion || this.native.lastAssertion || fallback, String(error.message||error));
          throw error;
        }
        if (payload.saveAs) this.localVariables[payload.saveAs] = result;
        break;
      }
      case "extract":
        if (["resBody", "resHeader", "cookie"].includes(payload.target)) {
          this.processExtractions([
            {
              target: payload.target,
              jsonPath: payload.jsonPath,
              variableName: payload.variableName,
              isGlobal: payload.isGlobal,
            },
          ]);
        } else {
          let extractedString = "";

          if (payload.target === "text") {
            extractedString = await this.web.extractText(
              payload.selector,
              payload.elementType,
            );
          } else if (payload.target === "value") {
            extractedString = await this.web.extractValue(
              payload.selector,
              payload.elementType,
            );
          } else if (payload.target === "attribute") {
            const val = await this.web.getAttribute(
              payload.selector,
              payload.attribute,
              payload.elementType,
            );
            extractedString = val || "";
          }

          if (payload.isGlobal) {
            FlowWorker.globalVariables[payload.variableName] = extractedString;
          } else {
            this.localVariables[payload.variableName] = extractedString;
          }
        }
        break;

      case "getOtp":
        if (!this.isSilent) {
          console.log(
            chalk.magenta(
              `\n      > [Notice]: Automated OTP extraction is a Flowstride Enterprise feature.`,
            ),
          );
          console.log(
            chalk.magenta(
              `      > Visit flowstride.io to start your 60-day free trial (up to 1000 free runs).`,
            ),
          );
          console.log(
            chalk.magenta(
              `      > You can cancel at any time before the 61st day.\n`,
            ),
          );
        }
        throw new Error(
          "FlowMail Error: Automated OTP extraction requires Flowstride Enterprise. Visit flowstride.io to start your 60-day free trial.",
        );

      case "plugin":
        if (!this.pluginManager) {
          throw new Error(
            `Framework Error: PluginManager is not instantiated.`,
          );
        }

        const alias = payload.pluginAlias;
        const method = payload.pluginMethod;

        let resolvedPath = localDeclarations.find(
          (d) => d.alias === alias,
        )?.path;

        if (!resolvedPath) {
          resolvedPath = globalDeclarations.find(
            (d) => d.alias === alias,
          )?.path;
        }

        if (!resolvedPath) {
          throw new Error(
            `Scoping Error: You tried to use the alias "${alias}" without registering it. Please add 'let ${alias} = "path/to/plugin.ts"' at the top of your scenario or feature.`,
          );
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
        const verb = action.toLowerCase() as
          | "get"
          | "post"
          | "put"
          | "patch"
          | "delete";
        const baseUrl = this.config.baseUrl || "http://localhost";
        this.lastApiUrl = payload.url.startsWith("http")
          ? payload.url
          : `${baseUrl.replace(/\/$/, "")}${payload.url.startsWith("/") ? payload.url : `/${payload.url}`}`;

        if (verb === "get" || verb === "delete") {
          await this.api[verb](payload.url, payload.headers);
        } else {
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
        this.emitApiTelemetry(
          "graphql",
          payload.url,
          payload.headers,
          payload.body,
        );
        this.processExtractions(payload.extract);
        break;

      case "autoHeal":
        throw new Error(
          "Error: flow.autoheal is a Flowstride Enterprise feature. Visit flowstride.io to upgrade.",
        );

      case "save":
        if (payload.type === "session") {
          const stateToSave = await this.web.getState();
          let apiCookies: any[] = [];
          try {
            const apiState = this.api.getState();
            if (
              apiState &&
              apiState.headers &&
              apiState.headers["set-cookie"]
            ) {
              const rawCookies = apiState.headers["set-cookie"];
              apiCookies = Array.isArray(rawCookies)
                ? rawCookies
                : [rawCookies];
            }
          } catch (e) {}

          let fallbackDomain: string | undefined = undefined;
          try {
            if (this.lastApiUrl) {
              fallbackDomain = new URL(this.lastApiUrl).hostname;
            }
          } catch (e) {}

          const hybridState = {
            cookies: [...(stateToSave.cookies || []), ...apiCookies],
            localStorage: stateToSave.localStorage || {},
            sessionStorage: (stateToSave as any).sessionStorage || {},
            fallbackDomain,
            storageOrigin: stateToSave.storageOrigin,
          };

          if (payload.isGlobal) {
            FlowWorker.globalBrowserSessions[payload.name] = hybridState;
          } else {
            this.localBrowserSessions[payload.name] = hybridState;
          }

          if (payload.persist) {
            try {
              const persistDir = path.join(
                process.cwd(),
                ".flowstride",
                "sessions",
              );
              if (!fs.existsSync(persistDir)) {
                fs.mkdirSync(persistDir, { recursive: true });
              }
              const persistPath = path.join(persistDir, `${payload.name}.json`);
              fs.writeFileSync(
                persistPath,
                JSON.stringify(hybridState, null, 2),
                "utf-8",
              );
            } catch (err: any) {
              if (!this.isSilent)
                console.error(
                  chalk.yellow(
                    `\n      > [Warning]: Could not persist: ${err.message}`,
                  ),
                );
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
            const persistPath = path.join(
              process.cwd(),
              ".flowstride",
              "sessions",
              `${payload.name}.json`,
            );
            if (fs.existsSync(persistPath)) {
              try {
                const fileData = fs.readFileSync(persistPath, "utf-8");
                loadedState = JSON.parse(fileData);

                if (payload.isGlobal) {
                  FlowWorker.globalBrowserSessions[payload.name] = loadedState;
                } else {
                  this.localBrowserSessions[payload.name] = loadedState;
                }
              } catch (err) {
                throw new Error(
                  `State Error: Failed to parse persisted session file for "${payload.name}".`,
                );
              }
            }
          }

          if (!loadedState)
            throw new Error(
              `State Error: The session "${payload.name}" does not exist in memory or on disk.`,
            );

          await this.web.injectStorage(
            loadedState.cookies,
            loadedState.localStorage,
            loadedState.fallbackDomain,
            loadedState.sessionStorage,
            loadedState.storageOrigin,
          );
        }
        break;

      case "open":
        await this.web.navigate(payload.url);
        break;
      case "click":
        await this.web.click(payload.selector, payload.elementType);
        break;
      case "hover":
        await this.web.hover(payload.selector, payload.elementType);
        break;
      case "forceClick":
        await this.web.forceClick(payload.selector, payload.elementType);
        break;
      case "type":
        await this.web.type(
          payload.selector,
          payload.text,
          payload.elementType,
        );
        break;
      case "forceType":
        await this.web.forceType(
          payload.selector,
          payload.text,
          payload.elementType,
        );
        break;
      case "passcode":
        await this.web.passcode(
          payload.selector,
          payload.text,
          payload.elementType,
        );
        break;
      case "check":
        await this.web.check(payload.selector, payload.elementType);
        break;
      case "uncheck":
        await this.web.uncheck(payload.selector, payload.elementType);
        break;
      case "upload":
        await this.web.upload(
          payload.selector,
          payload.file,
          payload.elementType,
        );
        break;
      case "set":
        await this.web.set(
          payload.selector,
          payload.value,
          payload.elementType,
        );
        break;
      case "select":
        await this.web.select(
          payload.option,
          payload.selector,
          payload.elementType,
        );
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
        const expectType = payload.type;

        if (
          ["status", "responseTime", "resBody", "resHeader", "cookie"].includes(
            expectType,
          )
        ) {
          const apiState = this.api.getState();

          if (expectType === "status") {
            const expectedStatus = payload.statusCode || payload.value;
            if (String(apiState.status) !== String(expectedStatus))
              throw new Error(
                `API Assertion Failed: Expected HTTP status ${expectedStatus}, but got ${apiState.status}`,
              );
          } else if (expectType === "responseTime") {
            const threshold = validateResponseTimeThreshold(payload.threshold ?? payload.value)!;
            if (apiState.responseTime > threshold)
              throw new Error(
                `API Assertion Failed: Expected response time to be less than ${threshold}ms, but got ${apiState.responseTime}ms`,
              );
          } else {
            let actualValue;
            if (expectType === "resBody")
              actualValue = this.extractFromJsonPath(
                apiState.body,
                payload.jsonPath,
              );
            else if (expectType === "resHeader")
              actualValue =
                apiState.headers?.[(payload.jsonPath || "").toLowerCase()];
            else if (expectType === "cookie") {
              const cookies = apiState.headers?.["set-cookie"];
              if (Array.isArray(cookies)) {
                const match = cookies.find((c) =>
                  c.startsWith(`${payload.jsonPath}=`),
                );
                if (match) actualValue = match.split("=")[1].split(";")[0];
              }
            }

            const assertionsArray = Array.isArray(payload.assertions)
              ? payload.assertions
              : payload.condition
                ? [{ condition: payload.condition, value: payload.value }]
                : [];

            validateApiAssertions(assertionsArray);
            for (const assertion of assertionsArray) {
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
                    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                      strActual,
                    );
                else if (expectedLower === "url") {
                  try {
                    new URL(strActual);
                    isValid = true;
                  } catch {
                    isValid = false;
                  }
                } else if (expectedLower === "date")
                  isValid = !isNaN(Date.parse(strActual));
                else if (expectedLower === "hex")
                  isValid = /^#?([a-f0-9]{6}|[a-f0-9]{3})$/i.test(strActual);
                else {
                  let actualType: string = typeof actualValue;
                  if (actualValue === null) actualType = "null";
                  else if (Array.isArray(actualValue)) actualType = "array";
                  isValid = actualType === expectedLower;
                }

                if (!isValid)
                  throw new Error(
                    `API Assertion Failed: Expected "${payload.jsonPath}" to be ${expectedLower}, but got "${actualValue}"`,
                  );
              } else if (condition === "matches") {
                const regex = new RegExp(rawExpected);
                if (!regex.test(String(actualValue))) {
                  throw new Error(
                    `API Assertion Failed: Expected "${payload.jsonPath}" to match regex "${rawExpected}", but got "${String(actualValue)}"`,
                  );
                }
              } else if (["greaterthan", "lessthan"].includes(condition)) {
                const numActual = Number(actualValue);
                const numExpected = Number(rawExpected);
                if (isNaN(numActual) || isNaN(numExpected))
                  throw new Error(
                    `API Assertion Failed: Numeric comparison requires valid numbers.`,
                  );
                if (condition === "greaterthan" && !(numActual > numExpected))
                  throw new Error(
                    `API Assertion Failed: Expected ${numActual} > ${numExpected}`,
                  );
                if (condition === "lessthan" && !(numActual < numExpected))
                  throw new Error(
                    `API Assertion Failed: Expected ${numActual} < ${numExpected}`,
                  );
              } else if (condition.startsWith("length")) {
                const len =
                  Array.isArray(actualValue) || typeof actualValue === "string"
                    ? actualValue.length
                    : undefined;
                if (len === undefined)
                  throw new Error(
                    `API Assertion Failed: "${payload.jsonPath}" has no length.`,
                  );
                const numExpected = Number(rawExpected);
                if (condition === "length" && len !== numExpected)
                  throw new Error(
                    `API Assertion Failed: Expected length ${numExpected}, got ${len}`,
                  );
                if (condition === "length.greaterthan" && !(len > numExpected))
                  throw new Error(
                    `API Assertion Failed: Expected length > ${numExpected}, got ${len}`,
                  );
                if (condition === "length.lessthan" && !(len < numExpected))
                  throw new Error(
                    `API Assertion Failed: Expected length < ${numExpected}, got ${len}`,
                  );
              } else if (["includes", "does.not.include"].includes(condition)) {
                const isArrayOrString =
                  Array.isArray(actualValue) || typeof actualValue === "string";
                if (!isArrayOrString)
                  throw new Error(
                    `API Assertion Failed: Cannot check inclusion on non-collection type.`,
                  );
                const hasItem = actualValue.includes(rawExpected);
                if (condition === "includes" && !hasItem)
                  throw new Error(
                    `API Assertion Failed: Expected inclusion of "${rawExpected}"`,
                  );
                if (condition === "does.not.include" && hasItem)
                  throw new Error(
                    `API Assertion Failed: Expected exclusion of "${rawExpected}"`,
                  );
              } else if (["has.key", "does.not.have.key"].includes(condition)) {
                if (typeof actualValue !== "object" || actualValue === null)
                  throw new Error(
                    `API Assertion Failed: Key check requires object.`,
                  );
                const hasKey = rawExpected in actualValue;
                if (condition === "has.key" && !hasKey)
                  throw new Error(
                    `API Assertion Failed: Object missing key "${rawExpected}"`,
                  );
                if (condition === "does.not.have.key" && hasKey)
                  throw new Error(
                    `API Assertion Failed: Object should not contain key "${rawExpected}"`,
                  );
              } else if (["is.empty", "not.empty"].includes(condition)) {
                const isEmpty =
                  actualValue === undefined ||
                  actualValue === null ||
                  actualValue === "" ||
                  (Array.isArray(actualValue) && actualValue.length === 0) ||
                  (typeof actualValue === "object" &&
                    Object.keys(actualValue).length === 0);

                const isNegated = condition === "not.empty";
                const passed = isNegated ? !isEmpty : isEmpty;
                if (!passed)
                  throw new Error(
                    `API Assertion Failed: Expected "${payload.jsonPath}" to be ${isNegated ? "not empty" : "empty"}, but got "${actualValue}"`,
                  );
              } else {
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

                if (
                  ["equals", "contains"].includes(condition) ||
                  ((isToBe || isNegated) && !knownTypes.includes(expectedLower))
                ) {
                  const strActual = String(actualValue);
                  const isEquals =
                    condition === "equals" ||
                    ((isToBe || isNegated) && !knownTypes.includes(expectedLower));

                  if (isEquals) {
                    const match = strActual === rawExpected;
                    const passed = isNegated ? !match : match;
                    if (!passed)
                      throw new Error(
                        `API Assertion Failed: Expected "${payload.jsonPath}" ${isNegated ? "not to equal" : "to equal"} "${rawExpected}", but got "${strActual}"`,
                      );
                  } else if (condition === "contains") {
                    const match = strActual.includes(rawExpected);
                    if (!match)
                      throw new Error(
                        `API Assertion Failed: Expected "${strActual}" to contain "${rawExpected}"`,
                      );
                  }
                } else if (isToBe || isNegated) {
                  let checkPassed = false;
                  let actualType: string = typeof actualValue;
                  if (actualValue === null) actualType = "null";
                  else if (Array.isArray(actualValue)) actualType = "array";
                  else if (actualValue === undefined) actualType = "undefined";

                  checkPassed = isNegated
                    ? actualType !== expectedLower
                    : actualType === expectedLower;

                  if (!checkPassed) {
                    const expectedStr = isNegated
                      ? `not to be "${expectedLower}"`
                      : `to be "${expectedLower}"`;
                    throw new Error(
                      `API Assertion Failed: Expected "${payload.jsonPath}" ${expectedStr}, but got type "${actualType}".`,
                    );
                  }
                }
              }
            }
          }
        } else if (expectType === "visible")
          await this.web.expectVisible(payload.selector, payload.elementType);
        else if (expectType === "text")
          await this.web.expectText(
            payload.selector,
            payload.fuzzy,
            payload.elementType,
          );
        else if (expectType === "value")
          await this.web.expectValue(
            payload.selector,
            payload.text,
            payload.elementType,
          );
        else if (expectType === "attribute") {
          const deadline = Date.now() + this.config.timeout;
          let actual: string | null = null;
          const failure = () => `Attribute assertion failed: ${payload.attribute} on ${payload.selector}. Expected ${payload.fuzzy ? 'to contain ' : ''}${JSON.stringify(payload.text)}, received ${JSON.stringify(actual)}.`;
          while (true) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new Error(failure());
            try {
              actual = await withDeadline(
                this.web.getAttribute(payload.selector, payload.attribute, payload.elementType), remaining,
              );
            } catch (error) {
              throw new Error(`${failure()}\n${error instanceof Error ? error.message : String(error)}`, { cause: error });
            }
            if (actual !== null && (payload.fuzzy ? actual.includes(payload.text) : actual === payload.text)) break;
            if (Date.now() >= deadline) throw new Error(failure());
            await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(50, deadline - Date.now()))));
          }
        }
        else if (expectType === "transcript")
          await this.web.expectTranscript(payload.text);
        break;
    }
  }

  private async setupNetworkInterception() {
    const context = this.web.getPage().context();
    if (this.interceptedContexts.has(context)) return;
    this.interceptedContexts.add(context);
    context.on("response", async (response) => {
      const lockedFileName = this.currentFileName;
      const request = response.request();
      const type = request.resourceType();
      if (type !== "fetch" && type !== "xhr") return;

      let responseBody: any = null;
      try {
        const text = await response.text();
        responseBody = JSON.parse(text);
      } catch {
        responseBody = "[Body capture failed]";
      }

      let requestBody: any = null;
      let rawPostData: string | null = null;
      try {
        rawPostData = request.postData();
        if (rawPostData) requestBody = JSON.parse(rawPostData);
      } catch {
        requestBody = "[Request body capture failed]";
      }

      const sharedId = Math.random().toString(36).substr(2, 9);
      const urlObj = new URL(request.url());
      const endpointName = urlObj.pathname.split("/").pop() || urlObj.pathname;

      const requestHeaders = await request.allHeaders().catch(() => request.headers());
      const curlString = this.web.synthesizeCurl(
        request.method(),
        request.url(),
        requestHeaders,
        rawPostData,
      );

      this.emitLog(
        "REST",
        response.status() < 400 ? "success" : "error",
        `${request.method()} ${endpointName}`,
        {
          method: request.method(),
          url: request.url(),
          requestHeaders: requestHeaders,
          requestBody: requestBody,
          rawReplayRequest: { method: request.method(), url: request.url(), headers: requestHeaders, body: rawPostData },
          responseStatus: response.status(),
          responseHeaders: response.headers(),
          responseBody: responseBody,
          curlString: curlString,
        },
        sharedId,
        lockedFileName,
      );

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

  private async startStreaming() {
    clearInterval(this.fallbackStream);
    if (this.config.ci) return;
    if (this.config.browser && this.config.browser !== 'chromium') {
      const page = this.web.getPage(); let busy = false;
      this.fallbackStream = setInterval(async () => {
        if (busy || page.isClosed()) return; busy = true;
        try { this.broadcast('BROWSER_FRAME', { base64: (await page.screenshot({ type:'jpeg', quality:60 })).toString('base64'), fileName:this.currentFileName }); } catch {} finally { busy = false; }
      }, 250);
      this.fallbackStream.unref(); return;
    }
    const page = this.web.getPage();
    if (this.currentCdpSession) {
      await this.currentCdpSession.detach().catch(() => {});
    }

    this.currentCdpSession = await page.context().newCDPSession(page);
    await this.currentCdpSession.send("Page.startScreencast", {
      format: "jpeg",
      quality: 60,
    });
    this.currentCdpSession.on(
      "Page.screencastFrame",
      ({ data, sessionId }: any) => {
        this.broadcast("BROWSER_FRAME", {
          base64: data,
          fileName: this.currentFileName,
        });
        this.currentCdpSession
          .send("Page.screencastFrameAck", { sessionId })
          .catch(() => {});
      },
    );
  }

  public async shutdown(): Promise<void> {
    clearInterval(this.fallbackStream);
    await this.native.dispose();
    try {
      await this.web.shutdown();
    } catch (e) {}
  }
}

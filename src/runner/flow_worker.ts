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
  private isSilent = process.env.FLOWSTRIDE_PARALLEL === "true";
  private isAborted = false;
  private isDebugHalted = false;

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
  }

  private broadcast(type: string, payload: any) {
    this.emit("worker_event", { type, payload });
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
    const msg = error.message || String(error);
    if (
      msg.includes("API Assertion Failed") ||
      msg.includes("Network Execution Error") ||
      msg.includes("Extraction Failed") ||
      msg.includes("Plugin Execution Failed") ||
      msg.includes("Scoping Error")
    )
      return msg;
    const target =
      payload.selector || payload.text || payload.url || "the element";
    if (msg.includes("Timeout"))
      return `I waited for "${target}" to appear, but it never did.`;
    if (msg.includes("intercepted"))
      return `I found "${target}", but another element is blocking it.`;
    if (msg.includes("Framework rejected")) return msg;
    return `An error occurred while trying to ${action}: ${msg.split("\n")[0]}`;
  }

  private async captureStepContext(
    payload: any,
  ): Promise<{ screenshot?: string; boundingBox?: any }> {
    const page = this.web.getPage();
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
    try {
      let parsedHeaders = undefined;
      let parsedBody = undefined;
      try {
        if (payload.headers) parsedHeaders = JSON.parse(payload.headers);
      } catch (e) {}
      try {
        if (payload.body) parsedBody = JSON.parse(payload.body);
      } catch (e) {
        parsedBody = payload.body;
      }

      const fetchOptions: any = {
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
      } catch {
        responseBody = text;
      }

      this.broadcast("REPLAY_RES", {
        status,
        responseBody,
        fileName: this.currentFileName,
      });
    } catch (error: any) {
      this.broadcast("REPLAY_RES", {
        status: 500,
        responseBody: { error: error.message },
        fileName: this.currentFileName,
      });
    }
  }

  public abort(): void {
    this.isAborted = true;
  }

  public async runBatch(filesToProcess: string[]): Promise<void> {
    // this.config.headless = true;
    const isCliHeadless = process.argv.includes("--headless");

    if (isCliHeadless) {
      this.config.headless = true;
    } else if (this.config.headless === undefined) {
      this.config.headless = false;
    }

    this.activeAudioPath = undefined;
    this.isAborted = false;
    this.isDebugHalted = false;

    const sigintHandler = async () => {
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
      process.exit(0);
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
          const absolutePath = path.resolve(process.cwd(), rawPath);
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
        if (this.isAborted || this.isDebugHalted) break;

        const fileStartTime = Date.now();
        try {
          const fileName = path.basename(filePath);
          this.currentFileName = fileName;

          this.localVariables = {};
          this.localBrowserSessions = {};
          this.api.resetState();
          this.dataGen = new DataGenerators();

          await this.web.initialise(this.activeAudioPath);
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
            if (this.isAborted || this.isDebugHalted) break;
            if (f.scenarios.length === 0) continue;

            if (!this.isSilent)
              console.log(chalk.magenta.bold(`  Feature: ${f.name}`));
            for (const s of f.scenarios) {
              if (this.isAborted || this.isDebugHalted) break;

              if (!this.isSilent)
                console.log(chalk.cyan(`    Scenario: ${s.name}`));

              this.broadcast("RUN_START", {
                scenarioName: s.name,
                fileName: this.currentFileName,
              });

              await this.runScenario(s, f.declarations);

              if (this.isDebugHalted) break;

              await this.web
                .getPage()
                .waitForLoadState("load", { timeout: 4000 })
                .catch(() => {});
              await this.web
                .getPage()
                .waitForLoadState("networkidle", { timeout: 4000 })
                .catch(() => {});
              await new Promise((resolve) => setTimeout(resolve, 2000));
            }
          }

          if (this.isAborted) break;

          if (!this.isSilent)
            console.log(
              chalk.gray("\n[Execution]: Finalizing browser actions..."),
            );
          await new Promise((resolve) => setTimeout(resolve, 2000));

          try {
            const baseName = this.currentFileName.replace(".flow", "");
            const mockCloudDir = path.join(
              process.cwd(),
              ".flowstride",
              "mock-cloud",
            );
            if (!fs.existsSync(mockCloudDir))
              fs.mkdirSync(mockCloudDir, { recursive: true });

            const targetVideoPath = path.join(mockCloudDir, `${baseName}.webm`);

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
          if (this.isAborted) break;

          if (!this.isSilent)
            console.error(
              chalk.red(
                `\n[Execution]: Failed processing ${this.currentFileName}: ${e.message}`,
              ),
            );

          try {
            const baseName = this.currentFileName.replace(".flow", "");
            const mockCloudDir = path.join(
              process.cwd(),
              ".flowstride",
              "mock-cloud",
            );
            if (!fs.existsSync(mockCloudDir))
              fs.mkdirSync(mockCloudDir, { recursive: true });

            const targetVideoPath = path.join(mockCloudDir, `${baseName}.webm`);

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
            error: e.message,
          });
        }
      }

      if (!this.isSilent && !this.isAborted) {
        if (this.isDebugHalted) {
          console.log(
            chalk.cyan("\n[Execution]: Test suite halted by debug flag."),
          );
        } else {
          console.log(
            chalk.green("\n[Execution]: All suites completed successfully."),
          );
        }
      }
    } finally {
      process.removeListener("SIGINT", sigintHandler);
    }
  }

  private async runScenario(
    scenario: ScenarioNode,
    globalDeclarations: DeclarationNode[] = [],
  ) {
    for (const step of scenario.steps) {
      if (this.isAborted) break;

      const blockName = step.blockDescription.split(" ")[0];
      let blockDesc = step.blockDescription.substring(blockName.length).trim();

      blockDesc = this.resolveTextVariables(blockDesc);
      if (this.dataGen) blockDesc = this.dataGen.resolve(blockDesc);

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
        status: "running",
        fileName: this.currentFileName,
      });

      try {
        await this.executeStep(
          step.action,
          step.payload,
          scenario.declarations,
          globalDeclarations,
        );

        const stepContext = await this.captureStepContext(step.payload);
        spinner.succeed();
        this.broadcast("STEP_UPDATE", {
          id: step.id,
          status: "passed",
          screenshot: stepContext.screenshot,
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

        const stepContext = await this.captureStepContext(step.payload);

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
              reason: "Element not present after full timeout.",
              strippedDom,
            },
            undefined,
            this.currentFileName,
          );
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

        const humanReadableError = this.translateError(
          e,
          step.action,
          step.payload,
        );

        this.emitLog(
          "ERROR",
          "error",
          humanReadableError,
          {
            rawError: e.message,
            command: step.action,
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
          screenshot: stepContext.screenshot,
          fileName: this.currentFileName,
        });
        throw e;
      }
    }
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

    switch (action) {
      case "extract":
        this.processExtractions([
          {
            target: payload.target,
            jsonPath: payload.jsonPath,
            variableName: payload.variableName,
            isGlobal: payload.isGlobal,
          },
        ]);
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
            const threshold = payload.threshold || payload.value;
            if (apiState.responseTime > parseInt(threshold, 10))
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
                  (isToBe && !knownTypes.includes(expectedLower))
                ) {
                  const strActual = String(actualValue);
                  const isEquals =
                    condition === "equals" ||
                    (isToBe && !knownTypes.includes(expectedLower));

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
        else if (expectType === "transcript")
          await this.web.expectTranscript(payload.text);
        break;
    }
  }

  private async setupNetworkInterception() {
    const context = this.web.getPage().context();
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

      const curlString = this.web.synthesizeCurl(
        request.method(),
        request.url(),
        request.headers(),
        rawPostData,
      );

      this.emitLog(
        "REST",
        response.status() < 400 ? "success" : "error",
        `${request.method()} ${endpointName}`,
        {
          method: request.method(),
          url: request.url(),
          requestHeaders: request.headers(),
          requestBody: requestBody,
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
    try {
      await this.web.shutdown();
    } catch (e) {}
  }
}

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import * as os from "os";
import { pathToFileURL } from "url";
import { FlowWorker } from "../../runner/flow_worker";
import { FlowOrchestrator } from "../../runner/flow_orchestrator";
import { WebAdapter } from "../../adapters/web/playwright";
import { ApiAdapter } from "../../adapters/api/undici";
import { TemporaryStore } from "../../runner/temporary_store";
import { SessionManager } from "../../sessions/manager";
import { PersistentVault } from "../../runner/persistent_vault";
import { FlowstrideConfig } from "../../types";
import { PluginManager } from "../../runner/plugin_manager";
import { ApiProxy } from "../../sdk/api_proxy";

export async function runAction(
  targetPath: string,
  options: Record<string, any>,
) {
  const root = process.cwd();

  const profileEnvPath = options.env
    ? path.resolve(root, `.env.${options.env}`)
    : null;
  const defaultEnvPath = path.resolve(root, ".env");

  if (profileEnvPath) {
    if (fs.existsSync(profileEnvPath)) {
      dotenv.config({ path: profileEnvPath });
      console.log(`[Environment]: Loaded profile "${options.env}"`);
    } else {
      console.warn(
        `[Environment Warning]: --env ${options.env} was passed, but .env.${options.env} does not exist.`,
      );
    }
  }

  if (fs.existsSync(defaultEnvPath)) {
    dotenv.config({ path: defaultEnvPath });
    if (!options.env) {
      console.log(`[Environment]: Loaded default .env file`);
    }
  }

  const isCI = !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.JENKINS_URL ||
    process.env.FLOWSTRIDE_API_KEY
  );

  if (isCI) {
    console.log(
      "\n[CI/CD]: Environment detected. Engaging Smart Automation Behaviors...",
    );
  }

  const resolvedPath = targetPath;

  if (!fs.existsSync(resolvedPath)) {
    console.error(
      `\n[Error]: Cannot find strict target path "${resolvedPath}".`,
    );
    process.exit(1);
  }

  console.log(
    `\n[Flowstride]: Starting execution suite at "${resolvedPath}"...`,
  );

  const configPath = path.resolve(root, "flowstride.config.json");
  let localConfig: any = {};

  if (fs.existsSync(configPath)) {
    try {
      const fileContent = fs.readFileSync(configPath, "utf-8");
      localConfig = JSON.parse(fileContent);
      console.log(
        `[Config]: Loaded project configuration from flowstride.config.json`,
      );
    } catch (e: any) {
      console.warn(
        `[Warning]: Could not parse flowstride.config.json: ${e.message}`,
      );
    }
  }

  const config: FlowstrideConfig = {
    headless: isCI
      ? true
      : options.headed
        ? false
        : (localConfig.headless ?? true),
    timeout: localConfig.timeout ?? 30000,
    bail: options.bail ?? localConfig.bail ?? false,
    baseUrl: process.env.BASE_URL ?? localConfig.baseUrl,
    defaultDialogBehavior: isCI
      ? "dismiss"
      : (localConfig.defaultDialogBehavior ?? "dismiss"),
    pluginsDir: localConfig.pluginsDir,
  } as any;

  if (isCI) {
    console.log(`   > Headless Mode: ${config.headless ? "Forced ON" : "OFF"}`);
    console.log(
      `   > Dialog Protection: ${(config.defaultDialogBehavior || "dismiss").toUpperCase()}`,
    );
    console.log(`   > Artifact Auto-Staging: ENABLED\n`);
  }

  let workerCount = options.workers ? parseInt(options.workers, 10) : 1;
  if (isNaN(workerCount) || workerCount < 1) {
    console.error(
      `\n[Error]: Invalid worker count "${options.workers}". Must be an integer greater than 0.`,
    );
    process.exit(1);
  }

  const maxSafeWorkers = Math.max(1, os.cpus().length - 1);
  if (workerCount > maxSafeWorkers) {
    console.log(
      `\n[Warning]: You requested ${workerCount} workers, but your CPU only safely supports ${maxSafeWorkers}.`,
    );
    console.log(
      `[Warning]: Auto-capping to ${maxSafeWorkers} workers to prevent system thrashing and crashes.\n`,
    );
    workerCount = maxSafeWorkers;
  }

  const web = new WebAdapter(config);
  const api = new ApiAdapter(config);
  const store = new TemporaryStore();

  const apiProxy = new ApiProxy(api as any);
  const pluginManager = new PluginManager(config, web, store, apiProxy);

  const vault = new PersistentVault(root);
  const sessions = new SessionManager(web, api, vault);

  let ActiveFlowWorker: any = FlowWorker;
  let ActiveFlowOrchestrator: any = FlowOrchestrator;
  let engineMode = "Open Source";

  const proWorkerPath = path.join(
    process.cwd(),
    "node_modules",
    "@flowstride",
    "pro",
    "dist",
    "runner",
    "flow_worker.js",
  );
  const proOrchPath = path.join(
    process.cwd(),
    "node_modules",
    "@flowstride",
    "pro",
    "dist",
    "runner",
    "flow_orchestrator.js",
  );

  if (
    !options.forceOS &&
    fs.existsSync(proWorkerPath) &&
    fs.existsSync(proOrchPath)
  ) {
    try {
      const proWorkerModule = await import(pathToFileURL(proWorkerPath).href);
      const proOrchModule = await import(pathToFileURL(proOrchPath).href);

      ActiveFlowWorker = proWorkerModule.FlowWorker;
      ActiveFlowOrchestrator = proOrchModule.FlowOrchestrator;
      engineMode = "Enterprise (Pro)";
    } catch (err: any) {
      console.warn(
        `\n[Warning]: Found @flowstride/pro but failed to boot it. Falling back to Open Source engine. (${err.message})`,
      );
    }
  }

  console.log(`\n[Engine]: Booting Flowstride in ${engineMode} mode...`);

  const worker = new ActiveFlowWorker(
    config,
    web,
    api,
    store,
    sessions,
    pluginManager,
  );

  const orchestrator = new ActiveFlowOrchestrator(worker, workerCount, config);

  try {
    await orchestrator.start(resolvedPath);
    console.log("\n[Flowstride]: Execution suite completed successfully.");

    if (isCI) {
      const artifactsDir = path.resolve(root, "flowstride-artifacts");
      if (!fs.existsSync(artifactsDir)) {
        fs.mkdirSync(artifactsDir, { recursive: true });
      }
      console.log(
        `[CI Artifacts]: Test environment artifacts auto-staged to ./flowstride-artifacts/`,
      );
      process.exit(0);
    } else {
      console.log(
        "\n[Dashboard]: Server remains active for Replay and Debugging. Press Ctrl+C to exit.",
      );
      await new Promise(() => {});
    }
  } catch (error: any) {
    console.error("\n[Fatal Error]:", error.message);

    if (isCI) {
      console.log(
        `[CI Alert]: Terminating pipeline with exit code 1 to block deployment.`,
      );
    }

    process.exit(1);
  }
}

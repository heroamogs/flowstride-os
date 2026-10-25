import { runtimeFailure } from '../../reporting/runtime_failure';
import { needsNativeBrowserProtocol } from '../../native/compatibility';
import { projectPath } from '../../utils/projectPaths';
import { loadNativeConfig, isCIEnvironment } from '../../ci/config';
import { runNativeCI } from '../../ci/runtime';
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
    ? projectPath(root, `.env.${options.env}`)
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

  const config = loadNativeConfig(root, options);
  const isCI = !!config.ci;

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

  if (isCI) {
    console.log(`   > Headless Mode: ${config.headless ? "Forced ON" : "OFF"}`);
    console.log(
      `   > Dialog Protection: ${(config.defaultDialogBehavior || "dismiss").toUpperCase()}`,
    );
    console.log(`   > Artifact Auto-Staging: ENABLED\n`);
  }

  let workerCount = options.workers ? Number(options.workers) : 1;
  if (!Number.isSafeInteger(workerCount) || workerCount < 1) {
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

  if (config.manifest?.maxWorkers !== undefined && config.manifest.maxWorkers !== 'unlimited') workerCount = Math.min(workerCount, config.manifest.maxWorkers);

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

      if (config.ci && proOrchModule.FlowOrchestrator.nativeCIProtocol !== 1) throw new Error('Installed Pro engine does not support native CI protocol 1; install the matching Pro candidate.');
      if (needsNativeBrowserProtocol(resolvedPath, config) && (proWorkerModule.FlowWorker.nativeBrowserProtocol !== 2 || proOrchModule.FlowOrchestrator.nativeBrowserProtocol !== 2)) throw new Error('Installed Cloud engine does not support these native browser capabilities. Install the matching Cloud archive; this run will use OS fallback.');
      if (needsNativeBrowserProtocol(resolvedPath, config) && (proWorkerModule.FlowWorker.nativeAssertionProtocol !== 1 || proOrchModule.FlowOrchestrator.nativeAssertionProtocol !== 1)) throw new Error('Installed Cloud engine predates structured assertion reporting; this run will use OS fallback. Install the matching Cloud archive to update.');
      ActiveFlowWorker = proWorkerModule.FlowWorker;
      ActiveFlowOrchestrator = proOrchModule.FlowOrchestrator;
      engineMode = "Enterprise (Pro)";
    } catch (err: any) {
      console.warn(
        `\n[Warning]: Found @flowstride/pro but failed to boot it. Falling back to Open Source engine. (${runtimeFailure("run.setup",{path:resolvedPath},err,{file:resolvedPath})})`,
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

  if (isCI) {
    const result = await runNativeCI(worker, orchestrator, resolvedPath, config, engineMode);
    console.log(`[Flowstride]: ${result.status}; reports: ${config.artifactsDir}`);
    process.exit(result.status === 'passed' ? 0 : result.status === 'interrupted' ? 130 : 1);
  }

  const previousRunEvent = config.onRunEvent;
  config.onRunEvent = event => {
    previousRunEvent?.(event);
    if (event.type === 'RUN_COMPLETE') process.exitCode = event.payload?.status === 'success' ? 0 : ['aborted','interrupted'].includes(event.payload?.status) ? 130 : 1;
  };
  try {
    const isSuccess = await orchestrator.start(resolvedPath);
    process.exitCode = isSuccess ? 0 : 1;
    console.log(isSuccess ? "\n[Flowstride]: Execution suite completed successfully." : "\n[Flowstride]: Execution suite failed.");

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
    console.error("\n[Fatal Error]:", runtimeFailure("run.setup",{path:resolvedPath},error,{file:resolvedPath}));

    if (isCI) {
      console.log(
        `[CI Alert]: Terminating pipeline with exit code 1 to block deployment.`,
      );
    }

    process.exit(1);
  }
}

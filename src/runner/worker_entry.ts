import { FlowWorker } from "./flow_worker";
import { WebAdapter } from "../adapters/web/playwright";
import { ApiAdapter } from "../adapters/api/undici";
import { TemporaryStore } from "./temporary_store";
import { SessionManager } from "../sessions/manager";
import { PersistentVault } from "./persistent_vault";
import { PluginManager } from "./plugin_manager";
import { ApiProxy } from "../sdk/api_proxy";

process.on("message", async (message: any) => {
  if (message.type === "START_RUN") {
    const { files, config } = message.payload;

    try {
      const web = new WebAdapter(config);
      const api = new ApiAdapter(config);
      const store = new TemporaryStore();
      const apiProxy = new ApiProxy(api as any);
      const pluginManager = new PluginManager(config, web, store, apiProxy);
      const vault = new PersistentVault(process.cwd());
      const sessions = new SessionManager(web, api, vault);

      const worker = new FlowWorker(
        config,
        web,
        api,
        store,
        sessions,
        pluginManager,
      );

      const workerResults: any[] = [];
      let currentFileName = "Unknown";
      let currentScenarioName = "Unknown";

      worker.on("worker_event", (data) => {
        if (data.type === "RUN_START") {
          currentFileName = data.payload.fileName;
          currentScenarioName = data.payload.scenarioName;
        }

        if (data.type === "STEP_UPDATE") {
          let fileGroup = workerResults.find(
            (r) => r.fileName === currentFileName,
          );
          if (!fileGroup) {
            fileGroup = { fileName: currentFileName, steps: [] };
            workerResults.push(fileGroup);
          }

          fileGroup.steps.push({
            id: data.payload.id,
            status: data.payload.status,
          });
        }

        if (process.send) {
          process.send(data);
        }
      });

      await worker.runBatch(files);

      if (process.send) {
        process.send({
          type: "WORKER_COMPLETE",
          payload: { status: "success", results: workerResults },
        });
      }
    } catch (error: any) {
      if (process.send) {
        process.send({
          type: "WORKER_COMPLETE",
          payload: { status: "error", error: error.message },
        });
      }
    }
  }
});

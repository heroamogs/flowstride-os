"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const flow_worker_1 = require("./flow_worker");
const playwright_1 = require("../adapters/web/playwright");
const undici_1 = require("../adapters/api/undici");
const temporary_store_1 = require("./temporary_store");
const manager_1 = require("../sessions/manager");
const persistent_vault_1 = require("./persistent_vault");
const plugin_manager_1 = require("./plugin_manager");
const api_proxy_1 = require("../sdk/api_proxy");
process.on("message", async (message) => {
    if (message.type === "START_RUN") {
        const { files, config } = message.payload;
        try {
            const web = new playwright_1.WebAdapter(config);
            const api = new undici_1.ApiAdapter(config);
            const store = new temporary_store_1.TemporaryStore();
            const apiProxy = new api_proxy_1.ApiProxy(api);
            const pluginManager = new plugin_manager_1.PluginManager(config, web, store, apiProxy);
            const vault = new persistent_vault_1.PersistentVault(process.cwd());
            const sessions = new manager_1.SessionManager(web, api, vault);
            const worker = new flow_worker_1.FlowWorker(config, web, api, store, sessions, pluginManager);
            const workerResults = [];
            let currentFileName = "Unknown";
            let currentScenarioName = "Unknown";
            worker.on("worker_event", (data) => {
                if (data.type === "RUN_START") {
                    currentFileName = data.payload.fileName;
                    currentScenarioName = data.payload.scenarioName;
                }
                if (data.type === "STEP_UPDATE") {
                    let fileGroup = workerResults.find((r) => r.fileName === currentFileName);
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
        }
        catch (error) {
            if (process.send) {
                process.send({
                    type: "WORKER_COMPLETE",
                    payload: { status: "error", error: error.message },
                });
            }
        }
    }
});

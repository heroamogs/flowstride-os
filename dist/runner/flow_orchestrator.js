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
exports.FlowOrchestrator = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const http = __importStar(require("http"));
const chalk_1 = __importDefault(require("chalk"));
const ws_1 = require("ws");
class FlowOrchestrator {
    worker;
    workerCount;
    config;
    wss = null;
    httpServer = null;
    globalTestScenarios = [];
    stepStatusRegistry = new Map();
    constructor(worker, workerCount = 1, config) {
        this.worker = worker;
        this.workerCount = workerCount;
        this.config = config;
        this.worker.on("worker_event", (data) => {
            this.forwardToDashboard(data.type, data.payload);
        });
    }
    forwardToDashboard(type, payload) {
        if (this.wss) {
            this.wss.clients.forEach((client) => {
                if (client.readyState === 1)
                    client.send(JSON.stringify({ type, payload }));
            });
        }
    }
    async executeTestRun(targetPath) {
        this.forwardToDashboard("SUITE_START", {});
        let filesToProcess = [];
        const stats = fs.statSync(targetPath);
        if (stats.isDirectory()) {
            filesToProcess = fs
                .readdirSync(targetPath)
                .filter((f) => f.endsWith(".flow"))
                .map((f) => path.join(targetPath, f));
        }
        else {
            filesToProcess = [targetPath];
        }
        this.globalTestScenarios = [];
        this.stepStatusRegistry.clear();
        if (this.workerCount > 1) {
            console.log(chalk_1.default.magenta(`\n[Notice]: You requested ${this.workerCount} parallel workers, but distributed parallel execution is a Flowstride Enterprise feature.`));
            console.log(chalk_1.default.magenta(`[Notice]: Visit flowstride.io to upgrade. Falling back to sequential execution...\n`));
        }
        console.log(chalk_1.default.gray(`\n[Orchestrator]: Executing in standard sequential mode...`));
        const listener = (data) => {
            if (data.type === "STEP_UPDATE") {
                if (data.payload && data.payload.id && data.payload.fileName) {
                    const compositeKey = `${data.payload.fileName}_${data.payload.id}`;
                    this.stepStatusRegistry.set(compositeKey, data.payload.status);
                }
                this.globalTestScenarios.push(data.payload);
            }
        };
        this.worker.on("worker_event", listener);
        await this.worker.runBatch(filesToProcess);
        this.worker.off("worker_event", listener);
        this.forwardToDashboard("RUN_COMPLETE", { status: "success" });
    }
    async start(targetPath) {
        try {
            this.httpServer = http.createServer((req, res) => {
                res.setHeader("Access-Control-Allow-Origin", "*");
                if (req.url && req.url.startsWith("/videos/")) {
                    let urlObj;
                    try {
                        urlObj = new URL(req.url, `http://${req.headers.host}`);
                    }
                    catch (err) {
                        res.writeHead(400);
                        return res.end("Bad Request");
                    }
                    const rawVideoName = decodeURIComponent(urlObj.pathname.replace("/videos/", ""));
                    const videoName = path.basename(rawVideoName);
                    if (!videoName || videoName === "/" || videoName === ".") {
                        res.writeHead(400);
                        return res.end("Invalid video requested");
                    }
                    const videoPath = path.join(process.cwd(), ".flowstride", "mock-cloud", videoName);
                    if (fs.existsSync(videoPath)) {
                        const stat = fs.statSync(videoPath);
                        const fileSize = stat.size;
                        if (fileSize === 0) {
                            res.writeHead(200, {
                                "Content-Length": 0,
                                "Content-Type": "video/webm",
                            });
                            return res.end();
                        }
                        const range = req.headers.range;
                        if (range) {
                            const parts = range.replace(/bytes=/, "").split("-");
                            const start = parseInt(parts[0], 10);
                            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                            const chunksize = end - start + 1;
                            const file = fs.createReadStream(videoPath, { start, end });
                            const head = {
                                "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                                "Accept-Ranges": "bytes",
                                "Content-Length": chunksize,
                                "Content-Type": "video/webm",
                            };
                            res.writeHead(206, head);
                            file.pipe(res);
                        }
                        else {
                            const head = {
                                "Content-Length": fileSize,
                                "Content-Type": "video/webm",
                            };
                            res.writeHead(200, head);
                            fs.createReadStream(videoPath).pipe(res);
                        }
                    }
                    else {
                        res.writeHead(404);
                        res.end("Video not found");
                    }
                }
                else {
                    const uiDistPath = path.join(__dirname, "../../src/ui/dist");
                    let reqPath = req.url === "/"
                        ? "/index.html"
                        : req.url?.split("?")[0] || "/index.html";
                    let filePath = path.join(uiDistPath, reqPath);
                    if (!filePath.startsWith(uiDistPath)) {
                        res.writeHead(403);
                        return res.end("Forbidden");
                    }
                    if (fs.existsSync(filePath)) {
                        const extname = path.extname(filePath);
                        let contentType = "text/html";
                        switch (extname) {
                            case ".js":
                                contentType = "application/javascript";
                                break;
                            case ".css":
                                contentType = "text/css";
                                break;
                            case ".json":
                                contentType = "application/json";
                                break;
                            case ".png":
                                contentType = "image/png";
                                break;
                            case ".jpg":
                                contentType = "image/jpg";
                                break;
                            case ".svg":
                                contentType = "image/svg+xml";
                                break;
                            case ".ico":
                                contentType = "image/x-icon";
                                break;
                        }
                        res.writeHead(200, { "Content-Type": contentType });
                        fs.createReadStream(filePath).pipe(res);
                    }
                    else {
                        const indexPath = path.join(uiDistPath, "index.html");
                        if (fs.existsSync(indexPath)) {
                            res.writeHead(200, { "Content-Type": "text/html" });
                            fs.createReadStream(indexPath).pipe(res);
                        }
                        else {
                            res.writeHead(404);
                            res.end("Flowstride UI not found. Dashboard bundle is missing.");
                        }
                    }
                }
            });
            this.httpServer.on("error", (e) => {
                console.error(chalk_1.default.red(`\n[Error]: Failed to start local server: ${e.message}`));
                process.exit(1);
            });
            this.wss = new ws_1.WebSocketServer({ server: this.httpServer });
            this.wss.on("connection", (ws) => {
                ws.on("message", async (message) => {
                    const data = JSON.parse(message.toString());
                    if (data.type === "EXPORT_PDF_REQ") {
                        console.log(chalk_1.default.magenta(`\n[Notice]: Exporting high-fidelity PDF reports is a Flowstride Enterprise feature.`));
                        console.log(chalk_1.default.magenta(`[Notice]: Visit flowstride.io to upgrade and unlock advanced reporting.\n`));
                    }
                    else if (data.type === "REPLAY_REQ") {
                        await this.worker.handleReplayRequest(data.payload);
                    }
                    else if (data.type === "RERUN_REQ") {
                        await this.executeTestRun(targetPath);
                    }
                    else if (data.type === "STOP_REQ") {
                        console.log(chalk_1.default.yellow("\nReceived STOP signal from Dashboard. Halting execution..."));
                        this.worker.abort();
                        await this.worker.shutdown();
                        this.forwardToDashboard("RUN_COMPLETE", { status: "aborted" });
                    }
                });
            });
            this.httpServer.listen(0, async () => {
                const address = this.httpServer?.address();
                const port = typeof address === "object" && address !== null ? address.port : null;
                if (!port) {
                    console.error(chalk_1.default.red("\n[Error]: Could not bind to an available port."));
                    process.exit(1);
                }
                const localUrl = `http://localhost:${port}`;
                const { default: open } = await import("open");
                await open(localUrl);
                console.log(chalk_1.default.yellow(`\n[Dashboard]: Local server running at ${localUrl}`));
                console.log(chalk_1.default.yellow("[Dashboard]: Waiting for UI connection..."));
                while (this.wss.clients.size === 0)
                    await new Promise((r) => setTimeout(r, 250));
                console.log(chalk_1.default.green("[Dashboard]: Connected to UI!"));
                await this.executeTestRun(targetPath);
            });
            process.on("SIGINT", () => {
                this.wss?.close();
                this.httpServer?.close();
                process.exit();
            });
        }
        catch (e) {
            throw e;
        }
    }
}
exports.FlowOrchestrator = FlowOrchestrator;

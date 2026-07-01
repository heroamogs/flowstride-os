import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import chalk from "chalk";
import ora from "ora";
import { WebSocketServer } from "ws";
import { FlowWorker } from "./flow_worker";
import { FlowstrideConfig } from "../types";
import { PdfGenerator } from "../reporting/pdf_generator";

export class FlowOrchestrator {
  private wss: WebSocketServer | null = null;
  private httpServer: http.Server | null = null;

  private globalTestScenarios: any[] = [];
  private stepStatusRegistry: Map<string, string> = new Map();
  private pdfGenerator: PdfGenerator;
  private disconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private worker: FlowWorker,
    private workerCount: number = 1,
    private config?: FlowstrideConfig,
  ) {
    this.pdfGenerator = new PdfGenerator();
    this.worker.on("worker_event", (data) => {
      this.forwardToDashboard(data.type, data.payload);
    });
  }

  private forwardToDashboard(type: string, payload: any) {
    if (this.wss) {
      this.wss.clients.forEach((client) => {
        if (client.readyState === 1)
          client.send(JSON.stringify({ type, payload }));
      });
    }
  }

  private async executeTestRun(targetPath: string) {
    this.forwardToDashboard("SUITE_START", {});

    let filesToProcess: string[] = [];
    const stats = fs.statSync(targetPath);

    if (stats.isDirectory()) {
      filesToProcess = fs
        .readdirSync(targetPath)
        .filter((f) => f.endsWith(".flow"))
        .map((f) => path.join(targetPath, f));
    } else {
      filesToProcess = [targetPath];
    }

    this.globalTestScenarios = [];
    this.stepStatusRegistry.clear();

    if (this.workerCount > 1) {
      console.log(
        chalk.magenta(
          `\n[Notice]: You requested ${this.workerCount} parallel workers, but distributed parallel execution is a Flowstride Enterprise feature.`,
        ),
      );
      console.log(
        chalk.magenta(
          `[Notice]: Visit flowstride.io to upgrade. Falling back to sequential execution...\n`,
        ),
      );
    }

    console.log(
      chalk.gray(`\n[Orchestrator]: Executing in standard sequential mode...`),
    );

    const listener = (data: any) => {
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

  public async start(targetPath: string): Promise<void> {
    try {
      this.httpServer = http.createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");

        if (req.url && req.url.startsWith("/videos/")) {
          let urlObj;
          try {
            urlObj = new URL(req.url, `http://${req.headers.host}`);
          } catch (err) {
            res.writeHead(400);
            return res.end("Bad Request");
          }

          const rawVideoName = decodeURIComponent(
            urlObj.pathname.replace("/videos/", ""),
          );
          const videoName = path.basename(rawVideoName);

          if (!videoName || videoName === "/" || videoName === ".") {
            res.writeHead(400);
            return res.end("Invalid video requested");
          }

          const videoPath = path.join(
            process.cwd(),
            ".flowstride",
            "mock-cloud",
            videoName,
          );

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
            } else {
              const head = {
                "Content-Length": fileSize,
                "Content-Type": "video/webm",
              };
              res.writeHead(200, head);
              fs.createReadStream(videoPath).pipe(res);
            }
          } else {
            res.writeHead(404);
            res.end("Video not found");
          }
        } else {
          const uiDistPath = path.join(__dirname, "../../src/ui/dist");

          let reqPath =
            req.url === "/"
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
          } else {
            const indexPath = path.join(uiDistPath, "index.html");
            if (fs.existsSync(indexPath)) {
              res.writeHead(200, { "Content-Type": "text/html" });
              fs.createReadStream(indexPath).pipe(res);
            } else {
              res.writeHead(404);
              res.end("Flowstride UI not found. Dashboard bundle is missing.");
            }
          }
        }
      });

      this.httpServer.on("error", (e: any) => {
        console.error(
          chalk.red(`\n[Error]: Failed to start local server: ${e.message}`),
        );
        process.exit(1);
      });

      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on("connection", (ws) => {
        if (this.disconnectTimer) {
          clearTimeout(this.disconnectTimer);
          this.disconnectTimer = null;
        }

        ws.on("message", async (message) => {
          const data = JSON.parse(message.toString());

          if (data.type === "EXPORT_PDF_REQ") {
            let scenariosToExport = data.payload || [];
            if (scenariosToExport.length === 0) {
              scenariosToExport = this.globalTestScenarios;
            }
            await this.handleExportPdfRequest(scenariosToExport);
          } else if (data.type === "REPLAY_REQ") {
            await this.worker.handleReplayRequest(data.payload);
          } else if (data.type === "RERUN_REQ") {
            const requestedFile = data.payload?.filePath;
            let specificTarget = targetPath;

            if (requestedFile) {
              const targetStat = fs.statSync(targetPath);
              if (targetStat.isDirectory()) {
                specificTarget = path.join(targetPath, requestedFile);
              } else {
                specificTarget = path.join(
                  path.dirname(targetPath),
                  requestedFile,
                );
              }
            }
            await this.executeTestRun(specificTarget);
          } else if (data.type === "STOP_REQ") {
            console.log(
              chalk.yellow(
                "\nReceived STOP signal from Dashboard. Halting execution...",
              ),
            );
            this.worker.abort();
            await this.worker.shutdown();
            this.forwardToDashboard("RUN_COMPLETE", { status: "aborted" });
          }
        });

        ws.on("close", () => {
          if (this.wss && this.wss.clients.size === 0) {
            this.disconnectTimer = setTimeout(async () => {
              console.log(
                chalk.yellow(
                  "\n[Flowstride]: Dashboard disconnected. Shutting down framework...",
                ),
              );
              this.worker.abort();
              try {
                await this.worker.shutdown();
              } catch (e) {}
              this.wss?.close();
              this.httpServer?.close();
              process.exit(0);
            }, 3000);
          }
        });
      });

      this.httpServer.listen(0, async () => {
        const address = this.httpServer?.address();
        const port =
          typeof address === "object" && address !== null ? address.port : null;

        if (!port) {
          console.error(
            chalk.red("\n[Error]: Could not bind to an available port."),
          );
          process.exit(1);
        }

        const localUrl = `http://localhost:${port}`;
        const { default: open } = await import("open");
        await open(localUrl);

        console.log(
          chalk.yellow(`\n[Dashboard]: Local server running at ${localUrl}`),
        );
        console.log(chalk.yellow("[Dashboard]: Waiting for UI connection..."));

        while (this.wss!.clients.size === 0)
          await new Promise((r) => setTimeout(r, 250));

        console.log(chalk.green("[Dashboard]: Connected to UI!"));

        await this.executeTestRun(targetPath);
      });
    } catch (e: any) {
      throw e;
    }
  }

  private async handleExportPdfRequest(testScenariosFromUI: any[]) {
    try {
      const spinner = ora(
        chalk.blue("Compiling high-fidelity PDF report..."),
      ).start();

      const pdfPath =
        await this.pdfGenerator.generateTestcasePdf(testScenariosFromUI);

      // Convert the saved PDF to base64 to trigger the native browser download UI
      const pdfBuffer = fs.readFileSync(pdfPath);
      const base64Data = pdfBuffer.toString("base64");

      this.forwardToDashboard("EXPORT_PDF_RES", { base64: base64Data });
      this.forwardToDashboard("EXPORT_PDF_SUCCESS", { path: pdfPath });

      spinner.succeed(chalk.green(`PDF Exported Successfully: ${pdfPath}`));
    } catch (e: any) {
      console.error(
        chalk.red(`\n[Report Error]: Failed to generate PDF - ${e.message}`),
      );
      this.forwardToDashboard("EXPORT_PDF_ERROR", { error: e.message });
    }
  }
}

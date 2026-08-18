import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import { WebSocketServer } from "ws";
import chalk from "chalk";

export async function startManualWorkspaceServer(): Promise<void> {
  const cliInstallPath = path.resolve(__dirname, "../../..");
  const uiDistPath = path.join(cliInstallPath, "src", "ui", "dist");

  if (!fs.existsSync(uiDistPath)) {
    console.error(
      chalk.red(
        `\n❌ Error: UI build bundle not found at ${uiDistPath}. Please build the UI first.`,
      ),
    );
    process.exit(1);
  }

  const manualFlowsDir = path.join(process.cwd(), "manual_flows");
  const templatesDir = path.join(manualFlowsDir, "templates");
  const runsDir = path.join(manualFlowsDir, "runs");
  const mediaDir = path.join(manualFlowsDir, "media");
  const defectMediaDir = path.join(manualFlowsDir, "defect_media");
  const workspaceStateFile = path.join(manualFlowsDir, ".workspace_state.json");

  if (!fs.existsSync(templatesDir))
    fs.mkdirSync(templatesDir, { recursive: true });
  if (!fs.existsSync(runsDir)) fs.mkdirSync(runsDir, { recursive: true });
  if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
  if (!fs.existsSync(defectMediaDir))
    fs.mkdirSync(defectMediaDir, { recursive: true });

  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
  };

  const httpServer = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-File-Extension",
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    const urlObj = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    );
    const pathname = urlObj.pathname;

    // ============================================================================
    // VAULT 1: DESIGN REFERENCES (/media) -> STRICTLY LOCAL ONLY
    // ============================================================================

    if (req.method === "POST" && pathname === "/api/upload") {
      const ext = (req.headers["x-file-extension"] as string) || "";
      const allowedExts = [".png", ".jpg", ".jpeg", ".gif", ".mp4", ".webm"];

      if (!ext || !allowedExts.includes(ext.toLowerCase())) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({ error: "Invalid or missing file extension." }),
        );
      }

      const safeFilename = `media_${Date.now()}_${Math.random().toString(36).substring(2, 9)}${ext.toLowerCase()}`;
      const filePath = path.join(mediaDir, safeFilename);

      const MAX_SIZE = 104857600;
      let uploadedSize = 0;
      let isAborted = false;

      const writeStream = fs.createWriteStream(filePath);

      req.on("data", (chunk) => {
        if (isAborted) return;
        uploadedSize += chunk.length;
        if (uploadedSize > MAX_SIZE) {
          isAborted = true;
          writeStream.destroy();
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Payload Too Large. Max size is 100MB." }),
          );
        } else {
          writeStream.write(chunk);
        }
      });

      req.on("end", () => {
        if (isAborted) return;
        writeStream.end();
        console.log(
          chalk.blue(
            `\n[Reference Uploaded]: Securely saved ${safeFilename} (${(uploadedSize / 1024 / 1024).toFixed(2)} MB)`,
          ),
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ url: `/media/${safeFilename}` }));
      });

      req.on("error", (err) => {
        if (!isAborted) {
          writeStream.destroy();
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Upload stream failed" }));
        }
      });
      return;
    }

    if (req.method === "DELETE" && pathname === "/api/media") {
      try {
        const targetPath = urlObj.searchParams.get("filepath");
        if (!targetPath) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({ error: "filepath parameter is required" }),
          );
        }
        const rawFilename = targetPath.replace("/media/", "");
        const safeFilename = path.basename(rawFilename);
        const filePath = path.join(mediaDir, safeFilename);

        if (!fs.existsSync(filePath)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({ error: "Media file not found in vault" }),
          );
        }

        fs.unlinkSync(filePath);
        console.log(
          chalk.yellow(
            `\n[Reference Deleted]: Asset securely removed from manual_flows/media/${safeFilename}`,
          ),
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            message: "Media physically deleted",
          }),
        );
      } catch (e: any) {
        console.error(
          chalk.red(`\n[API Error]: Failed to delete media - ${e.message}`),
        );
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Internal server error while deleting media.",
          }),
        );
      }
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/media/")) {
      const filename = pathname.replace("/media/", "");
      const safeFilename = path.basename(filename);
      const filePath = path.join(mediaDir, safeFilename);

      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        return res.end("Media not found");
      }

      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = mimeTypes[ext] || "application/octet-stream";

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

        if (start >= stat.size || end >= stat.size || start > end) {
          res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
          return res.end();
        }

        const chunksize = end - start + 1;
        const file = fs.createReadStream(filePath, { start, end });
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": contentType,
        });
        file.pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": stat.size,
          "Content-Type": contentType,
        });
        fs.createReadStream(filePath).pipe(res);
      }
      return;
    }

    // ============================================================================
    // VAULT 2: DEFECT EVIDENCE (/defect_media) -> STRICTLY LOCAL ONLY
    // ============================================================================

    if (req.method === "POST" && pathname === "/api/upload-defect") {
      const ext = (req.headers["x-file-extension"] as string) || "";
      const allowedExts = [".png", ".jpg", ".jpeg", ".gif", ".mp4", ".webm"];

      if (!ext || !allowedExts.includes(ext.toLowerCase())) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(
          JSON.stringify({ error: "Invalid or missing file extension." }),
        );
      }

      const safeFilename = `defect_${Date.now()}_${Math.random().toString(36).substring(2, 9)}${ext.toLowerCase()}`;
      const filePath = path.join(defectMediaDir, safeFilename);

      const MAX_SIZE = 41943040; // Capped at 40MB
      let uploadedSize = 0;
      let isAborted = false;

      const writeStream = fs.createWriteStream(filePath);

      req.on("data", (chunk) => {
        if (isAborted) return;
        uploadedSize += chunk.length;
        if (uploadedSize > MAX_SIZE) {
          isAborted = true;
          writeStream.destroy();
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Payload Too Large. Max size is 40MB." }),
          );
        } else {
          writeStream.write(chunk);
        }
      });

      req.on("end", async () => {
        if (isAborted) return;
        writeStream.end();

        const finalUrl = `/defect_media/${safeFilename}`;
        console.log(
          chalk.green(
            `\n[Vault Success]: Defect Media secured locally at -> ${finalUrl}`,
          ),
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ url: finalUrl }));
      });

      req.on("error", (err) => {
        if (!isAborted) {
          writeStream.destroy();
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Upload stream failed" }));
        }
      });
      return;
    }

    if (req.method === "DELETE" && pathname === "/api/defect-media") {
      try {
        const targetPath = urlObj.searchParams.get("filepath");
        if (!targetPath) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({ error: "filepath parameter is required" }),
          );
        }

        const rawFilename = targetPath.replace("/defect_media/", "");
        const safeFilename = path.basename(rawFilename);

        const filePath = path.join(defectMediaDir, safeFilename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(
            chalk.yellow(
              `\n[Local Cache Cleared]: Asset securely removed from manual_flows/defect_media/${safeFilename}`,
            ),
          );
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            message: "Defect media processed for deletion",
          }),
        );
      } catch (e: any) {
        console.error(
          chalk.red(
            `\n[API Error]: Failed to delete defect media - ${e.message}`,
          ),
        );
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Internal server error while deleting defect media.",
          }),
        );
      }
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/defect_media/")) {
      const filename = pathname.replace("/defect_media/", "");
      const safeFilename = path.basename(filename);
      const filePath = path.join(defectMediaDir, safeFilename);

      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        return res.end("Defect media not found");
      }

      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = mimeTypes[ext] || "application/octet-stream";

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

        if (start >= stat.size || end >= stat.size || start > end) {
          res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
          return res.end();
        }

        const chunksize = end - start + 1;
        const file = fs.createReadStream(filePath, { start, end });
        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize,
          "Content-Type": contentType,
        });
        file.pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": stat.size,
          "Content-Type": contentType,
        });
        fs.createReadStream(filePath).pipe(res);
      }
      return;
    }

    // ============================================================================
    // CORE SYSTEM ROUTES
    // ============================================================================

    if (req.method === "POST" && pathname === "/api/save-design") {
      let body = "";

      req.on("data", (chunk) => {
        body += chunk.toString();
      });

      req.on("end", () => {
        try {
          const payload = JSON.parse(body);
          const rawFilename = payload.filename || `New Flow.json`;
          const canvasData = payload.canvasData;

          if (!canvasData) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(
              JSON.stringify({ error: "Missing canvasData in payload" }),
            );
          }

          let safeFilename = path.basename(rawFilename);
          if (!safeFilename.endsWith(".json")) {
            safeFilename += ".json";
          }

          const filePath = path.join(templatesDir, safeFilename);
          fs.writeFileSync(
            filePath,
            JSON.stringify(canvasData, null, 2),
            "utf-8",
          );

          console.log(
            chalk.green(
              `\n[Saved]: Template securely vaulted to manual_flows/templates/${safeFilename}`,
            ),
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              message: "Template saved securely",
              filename: safeFilename,
            }),
          );
        } catch (e: any) {
          console.error(
            chalk.red(`\n[API Error]: Failed to save template - ${e.message}`),
          );
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Internal server error while saving template.",
            }),
          );
        }
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/templates") {
      try {
        const files = fs
          .readdirSync(templatesDir)
          .filter((f) => f.endsWith(".json"));

        const templates = files.map((file) => ({
          id: file,
          name: file.replace(".json", ""),
        }));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ templates }));
      } catch (e: any) {
        console.error(
          chalk.red(
            `\n[API Error]: Failed to read templates directory - ${e.message}`,
          ),
        );
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Internal server error while reading templates.",
          }),
        );
      }
      return;
    }

    if (req.method === "GET" && pathname === "/api/template") {
      try {
        const targetFilename = urlObj.searchParams.get("filename");

        if (!targetFilename) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({ error: "Filename parameter is required" }),
          );
        }

        const safeFilename = path.basename(targetFilename);

        if (!safeFilename.endsWith(".json")) {
          res.writeHead(403, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({
              error: "Forbidden: Only JSON configuration files can be loaded",
            }),
          );
        }

        const filePath = path.join(templatesDir, safeFilename);

        if (!fs.existsSync(filePath)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Template file not found" }));
        }

        const fileContent = fs.readFileSync(filePath, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(fileContent);
      } catch (e: any) {
        console.error(
          chalk.red(`\n[API Error]: Failed to load template - ${e.message}`),
        );
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Internal server error while loading template.",
          }),
        );
      }
      return;
    }

    if (req.method === "DELETE" && pathname === "/api/template") {
      try {
        const targetFilename = urlObj.searchParams.get("filename");

        if (!targetFilename) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({ error: "Filename parameter is required" }),
          );
        }

        const safeFilename = path.basename(targetFilename);

        if (!safeFilename.endsWith(".json")) {
          res.writeHead(403, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({
              error: "Forbidden: Only JSON configuration files can be deleted",
            }),
          );
        }

        const filePath = path.join(templatesDir, safeFilename);

        if (!fs.existsSync(filePath)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Template file not found" }));
        }

        fs.unlinkSync(filePath);
        console.log(
          chalk.yellow(
            `\n[Deleted]: Template securely removed from manual_flows/templates/${safeFilename}`,
          ),
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            message: "Template deleted successfully",
          }),
        );
      } catch (e: any) {
        console.error(
          chalk.red(`\n[API Error]: Failed to delete template - ${e.message}`),
        );
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Internal server error while deleting template.",
          }),
        );
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/save-run") {
      let body = "";

      req.on("data", (chunk) => {
        body += chunk.toString();
      });

      req.on("end", async () => {
        try {
          const payload = JSON.parse(body);
          const rawFilename =
            payload.filename || `Execution_Run_${Date.now()}.json`;
          const canvasData = payload.canvasData;

          if (!canvasData) {
            res.writeHead(400, { "Content-Type": "application/json" });
            return res.end(
              JSON.stringify({ error: "Missing canvasData in payload" }),
            );
          }

          const now = new Date();
          const dayFolder = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
          const timeFolder = `${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;

          const runTargetDir = path.join(runsDir, dayFolder, timeFolder);

          if (!fs.existsSync(runTargetDir)) {
            fs.mkdirSync(runTargetDir, { recursive: true });
          }

          let safeFilename = path.basename(rawFilename);
          if (!safeFilename.endsWith(".json")) {
            safeFilename += ".json";
          }

          const filePath = path.join(runTargetDir, safeFilename);
          fs.writeFileSync(
            filePath,
            JSON.stringify(canvasData, null, 2),
            "utf-8",
          );

          const relativePath = path
            .join(dayFolder, timeFolder, safeFilename)
            .split(path.sep)
            .join("/");

          console.log(
            chalk.green(
              `\n[Saved]: Run securely vaulted to manual_flows/runs/${relativePath}`,
            ),
          );

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              message: "Run saved securely",
              filename: relativePath,
            }),
          );
        } catch (e: any) {
          console.error(
            chalk.red(`\n[API Error]: Failed to save run - ${e.message}`),
          );
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Internal server error while saving run.",
            }),
          );
        }
      });
      return;
    }

    if (req.method === "GET" && pathname === "/api/runs") {
      try {
        const getAllRuns = (dir: string, baseDir: string): any[] => {
          let results: any[] = [];
          if (!fs.existsSync(dir)) return results;

          const list = fs.readdirSync(dir);

          for (const file of list) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);

            if (stat && stat.isDirectory()) {
              results = results.concat(getAllRuns(fullPath, baseDir));
            } else if (file.endsWith(".json")) {
              const relativePath = path
                .relative(baseDir, fullPath)
                .split(path.sep)
                .join("/");

              let status = "UNKNOWN";
              let passed = 0;
              let failed = 0;
              let total = 0;

              try {
                const fileData = fs.readFileSync(fullPath, "utf-8");
                const parsed = JSON.parse(fileData);

                if (
                  parsed.executionReport &&
                  Array.isArray(parsed.executionReport)
                ) {
                  total = parsed.executionReport.length;

                  passed = parsed.executionReport.filter((s: any) => {
                    const safeStatus = String(s.status || "").toLowerCase();
                    return ["pass", "passed", "success"].includes(safeStatus);
                  }).length;

                  failed = parsed.executionReport.filter((s: any) => {
                    const safeStatus = String(s.status || "").toLowerCase();
                    return safeStatus === "failed" || safeStatus === "fail";
                  }).length;

                  if (total === 0) {
                    status = "NO STEPS";
                  } else if (failed > 0) {
                    status = "FAIL";
                  } else if (passed === total) {
                    status = "PASS";
                  } else {
                    status = "INCOMPLETE";
                  }
                }
              } catch (parseError) {
                status = "CORRUPT";
              }

              results.push({
                id: relativePath,
                name: file.replace(".json", ""),
                metrics: { status, passed, failed, total },
              });
            }
          }
          return results;
        };

        const runs = getAllRuns(runsDir, runsDir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ runs }));
      } catch (e: any) {
        console.error(
          chalk.red(
            `\n[API Error]: Failed to read runs directory - ${e.message}`,
          ),
        );
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Internal server error while reading runs.",
          }),
        );
      }
      return;
    }

    if (req.method === "GET" && pathname === "/api/run") {
      try {
        const targetFilename = urlObj.searchParams.get("filename");

        if (!targetFilename) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({ error: "Filename parameter is required" }),
          );
        }

        if (
          targetFilename.includes("..") ||
          targetFilename.startsWith("/") ||
          targetFilename.startsWith("\\")
        ) {
          res.writeHead(403, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({ error: "Forbidden: Invalid file path" }),
          );
        }

        const filePath = path.join(runsDir, targetFilename);
        const resolvedPath = path.resolve(filePath);
        const resolvedRunsDir = path.resolve(runsDir);

        if (
          !resolvedPath.startsWith(resolvedRunsDir) ||
          !resolvedPath.endsWith(".json")
        ) {
          res.writeHead(403, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({
              error: "Forbidden: Unauthorized file access detected",
            }),
          );
        }

        if (!fs.existsSync(filePath)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Run file not found" }));
        }

        const fileContent = fs.readFileSync(filePath, "utf-8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(fileContent);
      } catch (e: any) {
        console.error(
          chalk.red(`\n[API Error]: Failed to load run - ${e.message}`),
        );
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "Internal server error while loading run." }),
        );
      }
      return;
    }

    if (req.method === "GET" && pathname === "/api/state") {
      try {
        if (fs.existsSync(workspaceStateFile)) {
          const stateContent = fs.readFileSync(workspaceStateFile, "utf-8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(stateContent);
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ activeFlowId: null }));
        }
      } catch (e: any) {
        console.error(
          chalk.red(
            `\n[API Error]: Failed to load workspace state - ${e.message}`,
          ),
        );
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Internal server error while loading state.",
          }),
        );
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/state") {
      let body = "";

      req.on("data", (chunk) => {
        body += chunk.toString();
      });

      req.on("end", () => {
        try {
          const payload = JSON.parse(body);
          const stateObj = {
            activeFlowId:
              typeof payload.activeFlowId === "string"
                ? payload.activeFlowId
                : null,
          };
          fs.writeFileSync(
            workspaceStateFile,
            JSON.stringify(stateObj, null, 2),
            "utf-8",
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch (e: any) {
          console.error(
            chalk.red(
              `\n[API Error]: Failed to save workspace state - ${e.message}`,
            ),
          );
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Internal server error while saving state.",
            }),
          );
        }
      });
      return;
    }

    const reqPath = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.resolve(uiDistPath, path.join(".", reqPath));

    if (
      !filePath.startsWith(uiDistPath + path.sep) &&
      filePath !== uiDistPath
    ) {
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
        case ".svg":
          contentType = "image/svg+xml";
          break;
        case ".ico":
          contentType = "image/x-icon";
          break;
        case ".wasm":
          contentType = "application/wasm";
          break;
      }

      res.writeHead(200, { "Content-Type": contentType });
      fs.createReadStream(filePath).pipe(res);
    } else {
      const reqExtname = path.extname(reqPath);
      if (reqExtname && reqExtname !== ".html") {
        res.writeHead(404);
        return res.end("Static asset not found.");
      }
      const indexPath = path.join(uiDistPath, "index.html");
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { "Content-Type": "text/html" });
        fs.createReadStream(indexPath).pipe(res);
      } else {
        res.writeHead(404);
        res.end("Flowstride UI bundle not found.");
      }
    }
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => {
    ws.send(
      JSON.stringify({ type: "CLI_CONTEXT", payload: { command: "open" } }),
    );

    ws.on("error", (err) => {
      console.error(chalk.red(`[WebSocket Error]: ${err.message}`));
    });
  });

  httpServer.on("error", (e: any) => {
    console.error(
      chalk.red(
        `\n[Error]: Failed to start manual workspace server: ${e.message}`,
      ),
    );
    process.exit(1);
  });

  httpServer.listen(0, async () => {
    try {
      const address = httpServer.address();
      const port =
        typeof address === "object" && address !== null ? address.port : null;

      if (!port) {
        console.error(
          chalk.red("\n[Error]: Could not bind to an available port."),
        );
        process.exit(1);
      }

      const localUrl = `http://localhost:${port}`;
      console.log(
        chalk.yellow(
          `\n[Workspace]: Manual Design server running at ${localUrl}`,
        ),
      );

      const { default: open } = await import("open");
      await open(localUrl);
      console.log(
        chalk.green(
          "[Workspace]: Manual UI launched successfully in browser. Press Ctrl+C to exit.\n",
        ),
      );
    } catch (err: any) {
      console.error(
        chalk.red(`\n[Error]: Failed to open browser: ${err.message}`),
      );
    }
  });

  process.on("SIGINT", () => {
    httpServer.close();
    process.exit(0);
  });
}

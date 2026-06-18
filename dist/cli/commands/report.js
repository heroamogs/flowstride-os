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
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportAction = reportAction;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
async function reportAction() {
    console.log("📊 Flowstride: Launching Debug Dashboard...");
    const targetProjectPath = process.cwd();
    const latestReportPath = path.join(targetProjectPath, "reports", "latest");
    const cliInstallPath = path.resolve(__dirname, "../../..");
    const reportPackagePath = path.join(cliInstallPath, "packages", "flowstride_report");
    const publicPath = path.join(reportPackagePath, "public");
    const runDataPath = path.join(latestReportPath, "run-data.json");
    if (!fs.existsSync(runDataPath)) {
        console.error('❌ Error: No run data found. Run "flowstride run" first to generate a report.');
        return;
    }
    if (!fs.existsSync(publicPath)) {
        fs.mkdirSync(publicPath, { recursive: true });
    }
    fs.copyFileSync(runDataPath, path.join(publicPath, "run-data.json"));
    const sourceScreenshots = path.join(latestReportPath, "screenshots");
    const targetScreenshots = path.join(publicPath, "screenshots");
    if (fs.existsSync(sourceScreenshots)) {
        if (!fs.existsSync(targetScreenshots)) {
            fs.mkdirSync(targetScreenshots, { recursive: true });
        }
        const files = fs.readdirSync(sourceScreenshots);
        for (const file of files) {
            fs.copyFileSync(path.join(sourceScreenshots, file), path.join(targetScreenshots, file));
        }
        console.log(`📸 Synced ${files.length} screenshots to dashboard.`);
    }
    try {
        console.log("Serving report at http://localhost:5173...");
        (0, child_process_1.execSync)("npm run dev", {
            cwd: reportPackagePath,
            stdio: "inherit",
        });
    }
    catch (error) {
        console.error("❌ CLI Error: Could not launch report dashboard.");
    }
}

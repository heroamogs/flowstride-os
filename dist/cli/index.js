#!/usr/bin/env node
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
const commander_1 = require("commander");
const run_1 = require("./commands/run");
const report_1 = require("./commands/report");
const init_1 = require("./commands/init");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const tar = __importStar(require("tar"));
const prompts_1 = require("@inquirer/prompts");
const chalk_1 = __importDefault(require("chalk"));
const ora_1 = __importDefault(require("ora"));
const program = new commander_1.Command();
const API_BASE = process.env.FLOWSTRIDE_API_URL || "https://cloud.flowstride.io";
program
    .name("flowstride")
    .description("Flowstride: The Enterprise Flow-First Automation CLI")
    .version("1.0.9");
program
    .command("init")
    .description("Initialise a new Flowstride workspace in the current directory")
    .action(async () => {
    await (0, init_1.initAction)();
});
program
    .command("login")
    .description("Authenticate this machine with Flowstride Enterprise Cloud")
    .action(async () => {
    const localPackageJsonPath = path.join(process.cwd(), "package.json");
    if (!fs.existsSync(localPackageJsonPath)) {
        console.error(chalk_1.default.red("✖ Error: Please navigate to a valid Flowstride project directory before logging in."));
        process.exit(1);
    }
    const pkg = JSON.parse(fs.readFileSync(localPackageJsonPath, "utf8"));
    const deps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
    };
    if (!deps["flowstride"] && !deps["flowstride-os"]) {
        console.error(chalk_1.default.red("✖ Error: Please navigate to a valid Flowstride project directory before logging in."));
        process.exit(1);
    }
    console.log(chalk_1.default.bold.blue("\n🌐 Flowstride Enterprise Cloud Sync\n"));
    let authHeader = "";
    if (process.env.FLOWSTRIDE_API_KEY) {
        console.log(chalk_1.default.yellow("🤖 CI/CD Environment Detected. Authenticating via API Key..."));
        authHeader = `Bearer ${process.env.FLOWSTRIDE_API_KEY}`;
    }
    else {
        const userEmail = await (0, prompts_1.input)({
            message: "Enter your Flowstride email:",
        });
        const userPass = await (0, prompts_1.password)({ message: "Enter your password:" });
        authHeader = `Basic ${Buffer.from(`${userEmail}:${userPass}`).toString("base64")}`;
    }
    const deviceName = os.hostname();
    const spinner = (0, ora_1.default)("Authenticating with Cloud...").start();
    try {
        const response = await fetch(`${API_BASE}/api/auth/cli-sync`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: authHeader,
            },
            body: JSON.stringify({ deviceName }),
        });
        const data = await response.json();
        if (!response.ok) {
            spinner.fail(chalk_1.default.red(`Authentication Failed: ${data.error || "Unknown error"}`));
            process.exit(1);
        }
        spinner.succeed(chalk_1.default.green("Authentication Successful!"));
        const configDir = path.join(process.cwd(), ".flowstride", "login");
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        const credentialsPath = path.join(configDir, "login.json");
        fs.writeFileSync(credentialsPath, JSON.stringify({
            machineToken: data.machineToken,
            workspaceId: data.workspaceId,
            deviceName: deviceName,
            syncedAt: new Date().toISOString(),
        }, null, 2));
        console.log(chalk_1.default.gray(`\nCredentials securely scoped to ${credentialsPath}`));
        if (data.isProEligible) {
            console.log(chalk_1.default.yellow(`\n⚙️ System Check: You have access to Enterprise features (AI Healing, Parallel Workers).`));
            const nodeModulesPath = path.join(process.cwd(), "node_modules", "@flowstride", "pro");
            if (!fs.existsSync(nodeModulesPath)) {
                let installPro = true;
                if (!process.env.FLOWSTRIDE_API_KEY && !process.env.CI) {
                    installPro = await (0, prompts_1.confirm)({
                        message: "The Pro Engine is not installed in this project. Would you like Flowstride to automatically install it now?",
                        default: true,
                    });
                }
                if (installPro) {
                    const installSpinner = (0, ora_1.default)("Downloading Enterprise Engine via secure proxy...").start();
                    const tarballPath = path.join(process.cwd(), "flowstride-pro.tgz");
                    try {
                        const tarballResponse = await fetch(`${API_BASE}/api/workspace/download-pro`, {
                            method: "GET",
                            headers: { Authorization: `Bearer ${data.machineToken}` },
                        });
                        if (!tarballResponse.ok) {
                            throw new Error(`Secure proxy rejected request: ${tarballResponse.statusText}`);
                        }
                        const buffer = await tarballResponse.arrayBuffer();
                        fs.writeFileSync(tarballPath, Buffer.from(buffer));
                        installSpinner.text = "Silently extracting Enterprise Engine...";
                        installSpinner.color = "cyan";
                        if (!fs.existsSync(nodeModulesPath)) {
                            fs.mkdirSync(nodeModulesPath, { recursive: true });
                        }
                        await tar.x({
                            file: tarballPath,
                            cwd: nodeModulesPath,
                            strip: 1,
                        });
                        installSpinner.succeed(chalk_1.default.green("Enterprise Engine installed successfully!"));
                    }
                    catch (installError) {
                        installSpinner.stop();
                        // ==========================================
                        // TEMPORARY DEBUG LOG TO UNMASK THE ERROR
                        // ==========================================
                        console.error(chalk_1.default.bgRed.white("\n[RAW SYSTEM ERROR]:"), installError);
                        // ==========================================
                        console.log(chalk_1.default.red("\n✖ Failed to install the Enterprise Engine. Please check your internet connection or verify your project configuration."));
                        if (fs.existsSync(nodeModulesPath)) {
                            fs.rmSync(nodeModulesPath, { recursive: true, force: true });
                        }
                        // THE FIX: Strict Rollback on Failure
                        console.log(chalk_1.default.yellow("⚠️ Reverting login: Enterprise Engine is required to sync."));
                        if (fs.existsSync(credentialsPath))
                            fs.unlinkSync(credentialsPath);
                        process.exit(1);
                    }
                    finally {
                        if (fs.existsSync(tarballPath)) {
                            fs.unlinkSync(tarballPath);
                        }
                    }
                }
                else {
                    // THE FIX: Strict Rollback on Decline
                    console.log(chalk_1.default.yellow(`\n⚠️ Installation skipped.`));
                    console.log(chalk_1.default.red(`✖ Reverting login: You must install the Enterprise Engine to sync this workspace.`));
                    if (fs.existsSync(credentialsPath))
                        fs.unlinkSync(credentialsPath);
                    process.exit(1);
                }
            }
        }
        // Only print this if the engine was successfully verified or installed
        console.log(chalk_1.default.bold.green(`\n✅ Machine synchronized with Flowstride Enterprise.`));
    }
    catch (error) {
        spinner.fail(chalk_1.default.red(`Network Error: Could not connect to cloud.flowstride.io`));
        process.exit(1);
    }
});
program
    .command("status")
    .description("Display the current Flowstride CLI authentication and engine tier")
    .action(async () => {
    let token = process.env.FLOWSTRIDE_API_KEY || null;
    const credentialsPath = path.join(process.cwd(), ".flowstride", "login", "login.json");
    const nodeModulesPath = path.join(process.cwd(), "node_modules", "@flowstride", "pro");
    if (!token && fs.existsSync(credentialsPath)) {
        try {
            const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
            token = credentials.machineToken;
        }
        catch (err) { }
    }
    // THE FIX: Defensive Self-Healing. If login exists but engine is missing, drop to OS.
    if (!process.env.FLOWSTRIDE_API_KEY &&
        token &&
        !fs.existsSync(nodeModulesPath)) {
        if (fs.existsSync(credentialsPath))
            fs.unlinkSync(credentialsPath);
        token = null;
    }
    if (!token) {
        console.log(chalk_1.default.white("⚪ [OS]: (Local Mode / Not Logged In)"));
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/api/auth/verify-cli`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
        });
        if (response.status === 401) {
            console.log(chalk_1.default.red("🔴 AUTH EXPIRED: Your device session was revoked or expired."));
            if (fs.existsSync(credentialsPath))
                fs.unlinkSync(credentialsPath);
        }
        else if (response.ok) {
            const data = await response.json();
            const tier = data.tier.toUpperCase();
            if (tier === "PERSONAL") {
                console.log(chalk_1.default.yellow(`🟡 [OS]: [${data.workspaceName}] (Tier: PERSONAL)`));
            }
            else {
                console.log(chalk_1.default.green(`🟢 [PRO]: [${data.workspaceName}] (Tier: ${tier})`));
            }
        }
        else {
            console.log(chalk_1.default.yellow("🛜 OFFLINE: Unable to reach Flowstride Cloud. Enterprise Sync paused."));
        }
    }
    catch (err) {
        console.log(chalk_1.default.yellow("🛜 OFFLINE: Unable to reach Flowstride Cloud. Enterprise Sync paused."));
    }
});
program
    .command("run")
    .description("Execute all .flow automation journeys in the ./flows directory")
    .option("-b, --bail", "Stop execution on first failure", false)
    .option("--headed", "Run browser in headed mode", false)
    .option("--headless <boolean>", "Run browser in headless mode", (val) => val === "true", true)
    .option("--workers <number>", "Number of parallel workers to spawn (Pro feature)")
    .action(async (options) => {
    let token = process.env.FLOWSTRIDE_API_KEY || null;
    let forceOS = false;
    const credentialsPath = path.join(process.cwd(), ".flowstride", "login", "login.json");
    const nodeModulesPath = path.join(process.cwd(), "node_modules", "@flowstride", "pro");
    if (!token && fs.existsSync(credentialsPath)) {
        try {
            const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
            token = credentials.machineToken;
        }
        catch (err) { }
    }
    // THE FIX: Defensive Self-Healing
    if (!process.env.FLOWSTRIDE_API_KEY &&
        token &&
        !fs.existsSync(nodeModulesPath)) {
        if (fs.existsSync(credentialsPath))
            fs.unlinkSync(credentialsPath);
        token = null;
    }
    if (!token) {
        console.log(chalk_1.default.white("⚪ [OS]: (Local Mode / Not Logged In)"));
        forceOS = true;
    }
    else {
        try {
            const response = await fetch(`${API_BASE}/api/auth/verify-cli`, {
                method: "GET",
                headers: { Authorization: `Bearer ${token}` },
            });
            if (response.status === 401) {
                console.log(chalk_1.default.red("🔴 AUTH EXPIRED: Your device session was revoked or expired."));
                if (fs.existsSync(credentialsPath))
                    fs.unlinkSync(credentialsPath);
                forceOS = true;
            }
            else if (response.ok) {
                const data = await response.json();
                const tier = data.tier.toUpperCase();
                if (tier === "PERSONAL") {
                    console.log(chalk_1.default.yellow(`🟡 [OS]: [${data.workspaceName}] (Tier: PERSONAL)`));
                }
                else {
                    console.log(chalk_1.default.green(`🟢 [PRO]: [${data.workspaceName}] (Tier: ${tier})`));
                }
            }
            else {
                forceOS = await handleOfflinePrompt();
            }
        }
        catch (err) {
            forceOS = await handleOfflinePrompt();
        }
    }
    if (options.headed) {
        options.headless = false;
    }
    const strictUiFlowsDir = path.resolve(process.cwd(), "./flows");
    if (!fs.existsSync(strictUiFlowsDir)) {
        console.error(`\n[ERROR]: Could not find ${strictUiFlowsDir}.`);
        console.error(`Flowstride requires all UI tests to be inside a './flows' directory.`);
        process.exit(1);
    }
    // Inject our DRM state into options before passing to runner
    options.forceOS = forceOS;
    await (0, run_1.runAction)(strictUiFlowsDir, options);
});
async function handleOfflinePrompt() {
    console.log(chalk_1.default.yellow("🛜 OFFLINE: Unable to reach Flowstride Cloud. Enterprise Sync paused."));
    if (process.env.CI || process.env.FLOWSTRIDE_API_KEY) {
        console.log(chalk_1.default.yellow("⚠️ CI/CD Environment: Automatically falling back to OS Engine."));
        return true; // Force OS
    }
    const runAnyway = await (0, prompts_1.confirm)({
        message: "⚠️ Execute a local OS run anyway? (Pro features are disabled on OS)",
        default: true,
    });
    if (!runAnyway) {
        process.exit(0);
    }
    return true; // User said yes, Force OS
}
program
    .command("report")
    .description("Launch the interactive Debug Dashboard")
    .action(async () => {
    await (0, report_1.reportAction)();
});
program.parse(process.argv);

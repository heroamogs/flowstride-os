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
exports.initAction = initAction;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const ora_1 = __importDefault(require("ora"));
// Convert standard exec to an async/await promise
const execAsync = (0, util_1.promisify)(child_process_1.exec);
async function initAction() {
    const root = process.cwd();
    const folders = ["flows", "reports", "plugins", "fixtures"];
    const sampleFlowPath = path.join(root, "flows", "example.flow");
    const fixturesReadmePath = path.join(root, "fixtures", "README.md");
    const gitignorePath = path.join(root, ".gitignore");
    console.log("\n[Info] Initializing new workspace...");
    // 1. Create Directories
    folders.forEach((folder) => {
        const dirPath = path.join(root, folder);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath);
            console.log(`[OK] Created directory: ${folder}/`);
        }
        else {
            console.log(`[Info] Directory already exists: ${folder}/`);
        }
    });
    // 2. Create Sample Flow
    const exampleContent = `
Feature: User login flow

Scenario: Ensure that user logs in successfully

Given "User lands on home page";
  flow.open "https://www.qacar.online/";

When "User clicks on Log in, near Sign Up";
  flow.click "Log in" near "Sign up";

When "User fill input fields"
  flow.type "Email" "user@flowstridemail.com";
  flow.type "Password" "Test@12345";

When "Click on Login button"
  flow.click button "Login"

And "Wait for login to complete"
  flow.expect visible "Logout"

When "Save the logged in session"
  flow.save global session "AdminLogin" persist

Then "Logout of the Admin dashboard"
  flow.click button "Logout [0]"
`;
    if (!fs.existsSync(sampleFlowPath)) {
        fs.writeFileSync(sampleFlowPath, exampleContent);
        console.log("[OK] Created sample flow: flows/example.flow");
    }
    // 3. Create Fixtures Readme
    const fixturesReadmeContent = `# Fixtures

Store your audio, image, and data assets in this directory.

- Audio files (.mp3, .wav) used with: flow.injectAudio "fixtures/your-audio.mp3"
- Images used for visual verification or uploads.
`;
    if (!fs.existsSync(fixturesReadmePath)) {
        fs.writeFileSync(fixturesReadmePath, fixturesReadmeContent);
        console.log("[OK] Created fixtures/README.md");
    }
    // 4. Secure the Workspace (.gitignore)
    const ignorePayload = `\n# Flowstride Execution Data\n.flowstride\nflowstride-artifacts\n`;
    if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, `node_modules\n${ignorePayload}`);
        console.log("[OK] Created .gitignore to secure local session data");
    }
    else {
        const existingIgnore = fs.readFileSync(gitignorePath, "utf8");
        if (!existingIgnore.includes(".flowstride")) {
            fs.appendFileSync(gitignorePath, ignorePayload);
            console.log("[OK] Updated .gitignore to secure local session data");
        }
    }
    console.log();
    const browserSpinner = (0, ora_1.default)("Downloading Chromium execution engine...").start();
    try {
        await execAsync("npx playwright install chromium");
        browserSpinner.succeed("Chromium execution engine installed successfully.");
    }
    catch (error) {
        browserSpinner.fail("Could not auto-install Chromium.");
        console.log("[Warning] Please run manually: npx playwright install chromium");
    }
    console.log("\n[Success] Workspace ready.");
    console.log(`[Info] Run tests using: flowstride run flows/example.flow\n`);
}

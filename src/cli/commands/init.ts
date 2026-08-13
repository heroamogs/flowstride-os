import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import { exec } from "child_process";
import { promisify } from "util";
import ora from "ora";

// Convert standard exec to an async/await promise
const execAsync = promisify(exec);

export async function initAction() {
  const root = process.cwd();

  // Added 'manual_flows' to strictly isolate manual test designs
  const folders = ["flows", "manual_flows", "reports", "plugins", "fixtures"];
  const sampleFlowPath = path.join(root, "flows", "example.flow");
  const fixturesReadmePath = path.join(root, "fixtures", "README.md");
  const gitignorePath = path.join(root, ".gitignore");

  console.log("\n[Info] Initialising new workspace...");

  // 1. Create Directories
  folders.forEach((folder) => {
    const dirPath = path.join(root, folder);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath);
      console.log(`[OK] Created directory: ${folder}/`);

      // Securely ensure the manual_flows directory is strictly tracked by Git even when empty
      if (folder === "manual_flows") {
        fs.writeFileSync(path.join(dirPath, ".gitkeep"), "");
      }
    } else {
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
  } else {
    const existingIgnore = fs.readFileSync(gitignorePath, "utf8");
    if (!existingIgnore.includes(".flowstride")) {
      fs.appendFileSync(gitignorePath, ignorePayload);
      console.log("[OK] Updated .gitignore to secure local session data");
    }
  }

  console.log();
  const browserSpinner = ora(
    "Downloading Chromium execution engine...",
  ).start();

  try {
    await execAsync("npx playwright install chromium");
    browserSpinner.succeed("Chromium execution engine installed successfully.");
  } catch (error) {
    browserSpinner.fail("Could not auto-install Chromium.");
    console.log(
      "[Warning] Please run manually: npx playwright install chromium",
    );
  }

  console.log("\n[Success] Workspace ready.");
  console.log(`[Info] Run tests using: flowstride run flows/example.flow\n`);
}

#!/usr/bin/env node
import { Command } from "commander";
import { runAction } from "./commands/run";
import { reportAction } from "./commands/report";
import { initAction } from "./commands/init";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as tar from "tar";
import { execSync } from "child_process";
import { input, password, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";

const program = new Command();
const API_BASE =
  process.env.FLOWSTRIDE_API_URL || "https://cloud.flowstride.io";

program
  .name("flowstride")
  .description("Flowstride: The Enterprise Flow-First Automation CLI")
  .version("1.0.14");

program
  .command("init")
  .description("Initialise a new Flowstride workspace in the current directory")
  .action(async () => {
    await initAction();
  });

program
  .command("login")
  .description("Authenticate this machine with Flowstride Enterprise Cloud")
  .action(async () => {
    const localPackageJsonPath = path.join(process.cwd(), "package.json");
    if (!fs.existsSync(localPackageJsonPath)) {
      console.error(
        chalk.red(
          "✖ Error: Please navigate to a valid Flowstride project directory before logging in.",
        ),
      );
      process.exit(1);
    }

    const pkg = JSON.parse(fs.readFileSync(localPackageJsonPath, "utf8"));
    const deps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    if (!deps["flowstride"] && !deps["flowstride-os"]) {
      console.error(
        chalk.red(
          "✖ Error: Please navigate to a valid Flowstride project directory before logging in.",
        ),
      );
      process.exit(1);
    }

    console.log(chalk.bold.blue("\n🌐 Flowstride Enterprise Cloud Sync\n"));

    let authHeader = "";
    if (process.env.FLOWSTRIDE_API_KEY) {
      console.log(
        chalk.yellow(
          "🤖 CI/CD Environment Detected. Authenticating via API Key...",
        ),
      );
      authHeader = `Bearer ${process.env.FLOWSTRIDE_API_KEY}`;
    } else {
      const userEmail = await input({
        message: "Enter your Flowstride email:",
      });
      const userPass = await password({ message: "Enter your password:" });
      authHeader = `Basic ${Buffer.from(`${userEmail}:${userPass}`).toString("base64")}`;
    }

    const deviceName = os.hostname();
    const spinner = ora("Authenticating with Cloud...").start();

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
        spinner.fail(
          chalk.red(`Authentication Failed: ${data.error || "Unknown error"}`),
        );
        process.exit(1);
      }

      spinner.succeed(chalk.green("Authentication Successful!"));

      const configDir = path.join(process.cwd(), ".flowstride", "login");
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      const credentialsPath = path.join(configDir, "login.json");
      fs.writeFileSync(
        credentialsPath,
        JSON.stringify(
          {
            machineToken: data.machineToken,
            workspaceId: data.workspaceId,
            deviceName: deviceName,
            syncedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );

      console.log(
        chalk.gray(`\nCredentials securely scoped to ${credentialsPath}`),
      );

      if (data.isProEligible) {
        console.log(
          chalk.yellow(
            `\n⚙️ System Check: You have access to Enterprise features (AI Healing, Parallel Workers).`,
          ),
        );

        const nodeModulesPath = path.join(
          process.cwd(),
          "node_modules",
          "@flowstride",
          "pro",
        );

        if (!fs.existsSync(nodeModulesPath)) {
          let installPro = true;

          if (!process.env.FLOWSTRIDE_API_KEY && !process.env.CI) {
            installPro = await confirm({
              message:
                "The Pro Engine is not installed in this project. Would you like Flowstride to automatically install it now?",
              default: true,
            });
          }

          if (installPro) {
            const installSpinner = ora(
              "Downloading Enterprise Engine via secure proxy...",
            ).start();
            const tarballPath = path.join(process.cwd(), "flowstride-pro.tgz");

            try {
              const tarballResponse = await fetch(
                `${API_BASE}/api/workspace/download-pro`,
                {
                  method: "GET",
                  headers: { Authorization: `Bearer ${data.machineToken}` },
                },
              );

              if (!tarballResponse.ok) {
                throw new Error(
                  `Secure proxy rejected request: ${tarballResponse.statusText}`,
                );
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

              installSpinner.text = "Wiring up Enterprise dependencies...";
              execSync("npm install --omit=dev", {
                cwd: nodeModulesPath,
                stdio: "ignore",
              });

              installSpinner.succeed(
                chalk.green("Enterprise Engine installed successfully!"),
              );
            } catch (installError) {
              installSpinner.stop();

              console.error(
                chalk.bgRed.white("\n[RAW SYSTEM ERROR]:"),
                installError,
              );

              console.log(
                chalk.red(
                  "\n✖ Failed to install the Enterprise Engine. Please check your internet connection or verify your project configuration.",
                ),
              );

              if (fs.existsSync(nodeModulesPath)) {
                fs.rmSync(nodeModulesPath, { recursive: true, force: true });
              }

              console.log(
                chalk.yellow(
                  "⚠️ Reverting login: Enterprise Engine is required to sync.",
                ),
              );
              if (fs.existsSync(credentialsPath))
                fs.unlinkSync(credentialsPath);
              process.exit(1);
            } finally {
              if (fs.existsSync(tarballPath)) {
                fs.unlinkSync(tarballPath);
              }
            }
          } else {
            console.log(chalk.yellow(`\n⚠️ Installation skipped.`));
            console.log(
              chalk.red(
                `✖ Reverting login: You must install the Enterprise Engine to sync this workspace.`,
              ),
            );
            if (fs.existsSync(credentialsPath)) fs.unlinkSync(credentialsPath);
            process.exit(1);
          }
        }
      }

      console.log(
        chalk.bold.green(
          `\n✅ Machine synchronized with Flowstride Enterprise.`,
        ),
      );
    } catch (error: any) {
      spinner.fail(
        chalk.red(`Network Error: Could not connect to cloud.flowstride.io`),
      );
      process.exit(1);
    }
  });

program
  .command("status")
  .description(
    "Display the current Flowstride CLI authentication and engine tier",
  )
  .action(async () => {
    let token = process.env.FLOWSTRIDE_API_KEY || null;
    const credentialsPath = path.join(
      process.cwd(),
      ".flowstride",
      "login",
      "login.json",
    );
    const nodeModulesPath = path.join(
      process.cwd(),
      "node_modules",
      "@flowstride",
      "pro",
    );

    if (!token && fs.existsSync(credentialsPath)) {
      try {
        const credentials = JSON.parse(
          fs.readFileSync(credentialsPath, "utf8"),
        );
        token = credentials.machineToken;
      } catch (err) {}
    }

    if (
      !process.env.FLOWSTRIDE_API_KEY &&
      token &&
      !fs.existsSync(nodeModulesPath)
    ) {
      if (fs.existsSync(credentialsPath)) fs.unlinkSync(credentialsPath);
      token = null;
    }

    if (!token) {
      console.log(chalk.white("⚪ [OS]: (Local Mode / Not Logged In)"));
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/auth/verify-cli`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401) {
        console.log(
          chalk.red(
            "🔴 AUTH EXPIRED: Your device session was revoked or expired.",
          ),
        );
        if (fs.existsSync(credentialsPath)) fs.unlinkSync(credentialsPath);
      } else if (response.ok) {
        const data = await response.json();
        const tier = data.tier.toUpperCase();
        if (tier === "PERSONAL") {
          console.log(
            chalk.yellow(`🟡 [OS]: [${data.workspaceName}] (Tier: PERSONAL)`),
          );
        } else {
          console.log(
            chalk.green(`🟢 [PRO]: [${data.workspaceName}] (Tier: ${tier})`),
          );
        }
      } else {
        console.log(
          chalk.yellow(
            "🛜 OFFLINE: Unable to reach Flowstride Cloud. Enterprise Sync paused.",
          ),
        );
      }
    } catch (err) {
      console.log(
        chalk.yellow(
          "🛜 OFFLINE: Unable to reach Flowstride Cloud. Enterprise Sync paused.",
        ),
      );
    }
  });

program
  .command("run [targetPath]")
  .description("Execute all .flow automation journeys in the ./flows directory")
  .option("-b, --bail", "Stop execution on first failure", false)
  .option("--headed", "Run browser in headed mode")
  .option("--headless", "Run browser in headless mode")
  .option(
    "--workers <number>",
    "Number of parallel workers to spawn (Pro feature)",
  )
  .action(
    async (targetPath: string | undefined, options: Record<string, any>) => {
      if (typeof targetPath === "object") {
        options = targetPath;
        targetPath = undefined;
      }

      let token = process.env.FLOWSTRIDE_API_KEY || null;
      let forceOS = false;
      const credentialsPath = path.join(
        process.cwd(),
        ".flowstride",
        "login",
        "login.json",
      );
      const nodeModulesPath = path.join(
        process.cwd(),
        "node_modules",
        "@flowstride",
        "pro",
      );

      if (!token && fs.existsSync(credentialsPath)) {
        try {
          const credentials = JSON.parse(
            fs.readFileSync(credentialsPath, "utf8"),
          );
          token = credentials.machineToken;
        } catch (err) {}
      }

      if (
        !process.env.FLOWSTRIDE_API_KEY &&
        token &&
        !fs.existsSync(nodeModulesPath)
      ) {
        if (fs.existsSync(credentialsPath)) fs.unlinkSync(credentialsPath);
        token = null;
      }

      if (!token) {
        console.log(chalk.white("⚪ [OS]: (Local Mode / Not Logged In)"));
        forceOS = true;
      } else {
        try {
          const response = await fetch(`${API_BASE}/api/auth/verify-cli`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
          });

          if (response.status === 401) {
            console.log(
              chalk.red(
                "🔴 AUTH EXPIRED: Your device session was revoked or expired.",
              ),
            );
            if (fs.existsSync(credentialsPath)) fs.unlinkSync(credentialsPath);
            forceOS = true;
          } else if (response.ok) {
            const data = await response.json();
            const tier = data.tier.toUpperCase();

            if (tier === "PERSONAL") {
              console.log(
                chalk.yellow(
                  `🟡 [OS]: [${data.workspaceName}] (Tier: PERSONAL)`,
                ),
              );
            } else {
              console.log(
                chalk.green(
                  `🟢 [PRO]: [${data.workspaceName}] (Tier: ${tier})`,
                ),
              );
            }
          } else {
            forceOS = await handleOfflinePrompt();
          }
        } catch (err) {
          forceOS = await handleOfflinePrompt();
        }
      }

      if (options.headed) {
        options.headless = false;
      }

      const resolvedTargetPath = targetPath ? targetPath : "./flows";
      const strictUiFlowsDir = path.resolve(process.cwd(), resolvedTargetPath);

      if (!fs.existsSync(strictUiFlowsDir)) {
        console.error(`\n[ERROR]: Could not find ${strictUiFlowsDir}.`);
        console.error(
          `Flowstride requires all UI tests to be inside a valid directory.`,
        );
        process.exit(1);
      }

      options.forceOS = forceOS;
      await runAction(strictUiFlowsDir, options);
    },
  );

async function handleOfflinePrompt(): Promise<boolean> {
  console.log(
    chalk.yellow(
      "🛜 OFFLINE: Unable to reach Flowstride Cloud. Enterprise Sync paused.",
    ),
  );

  if (process.env.CI || process.env.FLOWSTRIDE_API_KEY) {
    console.log(
      chalk.yellow(
        "⚠️ CI/CD Environment: Automatically falling back to OS Engine.",
      ),
    );
    return true;
  }

  const runAnyway = await confirm({
    message:
      "⚠️ Execute a local OS run anyway? (Pro features are disabled on OS)",
    default: true,
  });

  if (!runAnyway) {
    process.exit(0);
  }
  return true;
}

program
  .command("report")
  .description("Launch the interactive Debug Dashboard")
  .action(async () => {
    await reportAction();
  });

program.parse(process.argv);

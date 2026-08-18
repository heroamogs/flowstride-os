#!/usr/bin/env node
import { Command } from "commander";
import { runAction } from "./commands/run";
import { reportAction } from "./commands/report";
import { initAction } from "./commands/init";
import { openAction } from "./commands/open";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { password, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";

const program = new Command();
const API_BASE =
  process.env.FLOWSTRIDE_API_URL || "https://cloud.flowstride.io";

program
  .name("flowstride")
  .description("Flowstride: The Enterprise Flow-First Automation CLI")
  .version("1.0.18");

program
  .command("init")
  .description("Initialise a new Flowstride workspace in the current directory")
  .action(async () => {
    await initAction();
  });

program
  .command("login")
  .description("Authenticate this machine with Flowstride Enterprise Cloud")
  .option("-t, --token <token>", "Enterprise Developer Token")
  .option(
    "-g, --global",
    "Save the token globally for all projects on this machine",
    false,
  )
  .action(async (options) => {
    const localPackageJsonPath = path.join(process.cwd(), "package.json");

    // Enforce valid project directory ONLY if doing a local login
    if (!options.global) {
      if (!fs.existsSync(localPackageJsonPath)) {
        console.error(
          chalk.red(
            "✖ Error: Please navigate to a valid Flowstride project directory before logging in locally, or use --global.",
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
            "✖ Error: Please navigate to a valid Flowstride project directory before logging in locally, or use --global.",
          ),
        );
        process.exit(1);
      }
    }

    console.log(chalk.bold.blue("\n🌐 Flowstride Enterprise Cloud Sync\n"));

    let token = process.env.FLOWSTRIDE_TOKEN || options.token;

    if (process.env.FLOWSTRIDE_TOKEN) {
      console.log(
        chalk.yellow(
          "🤖 CI/CD Environment Detected. Authenticating via FLOWSTRIDE_TOKEN...",
        ),
      );
    } else if (!token) {
      token = await password({
        message: "Paste your Enterprise Developer Token:",
        mask: "*",
      });
    }

    if (!token || token.trim().length === 0) {
      console.error(chalk.red("✖ Error: A valid Developer Token is required."));
      process.exit(1);
    }

    const deviceName = os.hostname();
    const spinner = ora("Authenticating with Cloud...").start();

    try {
      const response = await fetch(`${API_BASE}/api/auth/cli-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ deviceName }),
      });

      const data = await response.json();

      if (!response.ok) {
        spinner.fail(
          chalk.red(
            `Authentication Failed: ${data.error || "Invalid token or network error"}`,
          ),
        );
        process.exit(1);
      }

      spinner.succeed(chalk.green("Authentication Successful!"));

      const configDir = options.global
        ? path.join(os.homedir(), ".flowstride")
        : path.join(process.cwd(), ".flowstride");

      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      const credentialsPath = path.join(configDir, "credentials.json");
      fs.writeFileSync(
        credentialsPath,
        JSON.stringify(
          {
            machineToken: data.machineToken || token.trim(),
            workspaceId: data.workspaceId,
            deviceName: deviceName,
            syncedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );

      const scopeText = options.global ? "GLOBALLY" : "LOCALLY to this project";
      console.log(
        chalk.gray(
          `\nCredentials securely scoped ${scopeText} at: ${credentialsPath}`,
        ),
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

          if (!process.env.FLOWSTRIDE_TOKEN && !process.env.CI) {
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
                  headers: { Authorization: `Bearer ${token.trim()}` },
                },
              );

              if (!tarballResponse.ok) {
                throw new Error(
                  `Secure proxy rejected request: ${tarballResponse.statusText}`,
                );
              }

              const buffer = await tarballResponse.arrayBuffer();
              fs.writeFileSync(tarballPath, Buffer.from(buffer));

              installSpinner.text = "Wiring up Enterprise dependencies...";
              installSpinner.color = "cyan";

              // Let npm natively handle the extraction and binary symlinking
              execSync(`npm install "${tarballPath}" --no-save`, {
                cwd: process.cwd(),
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
    let token = process.env.FLOWSTRIDE_TOKEN || null;
    const localCredentialsPath = path.join(
      process.cwd(),
      ".flowstride",
      "credentials.json",
    );
    const globalCredentialsPath = path.join(
      os.homedir(),
      ".flowstride",
      "credentials.json",
    );

    let activeCredentialsPath = localCredentialsPath; // Default for cleanup

    if (!token) {
      if (fs.existsSync(localCredentialsPath)) {
        activeCredentialsPath = localCredentialsPath;
        try {
          const credentials = JSON.parse(
            fs.readFileSync(localCredentialsPath, "utf8"),
          );
          token = credentials.machineToken;
        } catch (err) {}
      } else if (fs.existsSync(globalCredentialsPath)) {
        activeCredentialsPath = globalCredentialsPath;
        try {
          const credentials = JSON.parse(
            fs.readFileSync(globalCredentialsPath, "utf8"),
          );
          token = credentials.machineToken;
        } catch (err) {}
      }
    }

    const nodeModulesPath = path.join(
      process.cwd(),
      "node_modules",
      "@flowstride",
      "pro",
    );

    if (
      !process.env.FLOWSTRIDE_TOKEN &&
      token &&
      !fs.existsSync(nodeModulesPath)
    ) {
      if (fs.existsSync(activeCredentialsPath))
        fs.unlinkSync(activeCredentialsPath);
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
        if (fs.existsSync(activeCredentialsPath))
          fs.unlinkSync(activeCredentialsPath);
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

      let token = process.env.FLOWSTRIDE_TOKEN || null;
      let forceOS = false;

      const localCredentialsPath = path.join(
        process.cwd(),
        ".flowstride",
        "credentials.json",
      );
      const globalCredentialsPath = path.join(
        os.homedir(),
        ".flowstride",
        "credentials.json",
      );
      let activeCredentialsPath = localCredentialsPath;

      if (!token) {
        if (fs.existsSync(localCredentialsPath)) {
          activeCredentialsPath = localCredentialsPath;
          try {
            const credentials = JSON.parse(
              fs.readFileSync(localCredentialsPath, "utf8"),
            );
            token = credentials.machineToken;
          } catch (err) {}
        } else if (fs.existsSync(globalCredentialsPath)) {
          activeCredentialsPath = globalCredentialsPath;
          try {
            const credentials = JSON.parse(
              fs.readFileSync(globalCredentialsPath, "utf8"),
            );
            token = credentials.machineToken;
          } catch (err) {}
        }
      }

      const nodeModulesPath = path.join(
        process.cwd(),
        "node_modules",
        "@flowstride",
        "pro",
      );

      if (
        !process.env.FLOWSTRIDE_TOKEN &&
        token &&
        !fs.existsSync(nodeModulesPath)
      ) {
        if (fs.existsSync(activeCredentialsPath))
          fs.unlinkSync(activeCredentialsPath);
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
            if (fs.existsSync(activeCredentialsPath))
              fs.unlinkSync(activeCredentialsPath);
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

  if (process.env.CI || process.env.FLOWSTRIDE_TOKEN) {
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

program
  .command("open")
  .description("Launch the local manual QA UI Workspace")
  .action(async () => {
    await openAction();
  });

program.parse(process.argv);

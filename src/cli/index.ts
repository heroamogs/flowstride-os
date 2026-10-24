#!/usr/bin/env node
import { mergeResults } from '../ci/distribution';
import { projectPath } from '../utils/projectPaths';
import { cloudApiBase, cloudFailure } from '../utils/cloud';
import { loadCloudEnvironment, cloudSessionDescription, tokenExpiryDescription } from './utils/cloudSession';
import { loadNativeConfig } from '../ci/config';
import { initCI } from '../ci/init';
import { Command } from "commander";
import { runAction } from "./commands/run";
import { reportAction } from "./commands/report";
import { initAction } from "./commands/init";
import { openAction } from "./commands/open";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { installProEngine } from "./utils/proInstaller";
import { password, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";

const program = new Command();
program.hook('preAction', (_program, command) => {
  if (['login', 'status', 'run', 'update'].includes(command.name())) {
    API_BASE = loadCloudEnvironment(process.cwd(), command.opts().env);
  }
});

let API_BASE = cloudApiBase(process.env);

program
  .name("flowstride")
  .description("Flowstride: The Enterprise Flow-First Automation CLI")
  .version(require("../../package.json").version);

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

    console.log(`[Cloud]: ${API_BASE}; login credential source: ${process.env.FLOWSTRIDE_TOKEN ? 'FLOWSTRIDE_TOKEN (environment)' : options.token ? '--token option' : 'interactive prompt'}`);
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
            `Authentication Failed: ${cloudFailure({ response: { status: response.status, data } }, [token.trim()]).message}`,
          ),
        );
        process.exit(1);
      }

      spinner.succeed(chalk.green("Authentication Successful!"));
      console.log(tokenExpiryDescription(data));

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
            try {
              await installProEngine(API_BASE, token.trim());
              installSpinner.succeed(chalk.green("Enterprise Engine installed successfully!"));
            } catch (error) {
              installSpinner.fail(error instanceof Error ? error.message : "Enterprise installation failed");
              console.log(chalk.yellow("Credentials remain available. You can retry installation; runs can fall back to the Open Source engine."));
              process.exitCode = 1;
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
        chalk.red(cloudFailure(error, [token.trim()]).message),
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
    console.log(cloudSessionDescription(API_BASE));
    let token = process.env.FLOWSTRIDE_TOKEN?.trim() || null;
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
          token = credentials.machineToken?.trim() || null;
        } catch (err) {}
      } else if (fs.existsSync(globalCredentialsPath)) {
        activeCredentialsPath = globalCredentialsPath;
        try {
          const credentials = JSON.parse(
            fs.readFileSync(globalCredentialsPath, "utf8"),
          );
          token = credentials.machineToken?.trim() || null;
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

      if (response.status === 401 || response.status === 403) {
        const failureData = await response.json().catch(() => ({}));
        console.log(
          chalk.red(
            cloudFailure({ response: { status: response.status, data: failureData } }, [token]).message,
          ),
        );
        if (response.status === 401 && !process.env.FLOWSTRIDE_TOKEN && fs.existsSync(activeCredentialsPath))
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
  .option('--ci', 'Run without a dashboard and write CI reports')
  .option('--device <profile>', 'desktop, phone, or landscape')
  .option('--browser <engine>', 'chromium, firefox, or webkit')
  .option('--shard <index/total>', 'Run one deterministic CI shard, e.g. 1/4')
  .option('--shard-history <file>', 'Use merged timing history for shard balancing')
  .option('--update-baselines', 'Explicitly update ARIA baselines locally')
  .option('--config <file>', 'Path to the Flowstride configuration')
  .option('--env <name>', 'Environment profile')
  .action(
    async (targetPath: string | undefined, options: Record<string, any>) => {
      if (typeof targetPath === "object") {
        options = targetPath;
        targetPath = undefined;
      }

      if (options.ci) process.env.FLOWSTRIDE_NATIVE_CI = '1';
      console.log(cloudSessionDescription(API_BASE));
      let token = process.env.FLOWSTRIDE_TOKEN?.trim() || null;
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
            token = credentials.machineToken?.trim() || null;
          } catch (err) {}
        } else if (fs.existsSync(globalCredentialsPath)) {
          activeCredentialsPath = globalCredentialsPath;
          try {
            const credentials = JSON.parse(
              fs.readFileSync(globalCredentialsPath, "utf8"),
            );
            token = credentials.machineToken?.trim() || null;
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

          if (response.status === 401 || response.status === 403) {
            const failureData = await response.json().catch(() => ({}));
            console.log(
              chalk.red(
                cloudFailure({ response: { status: response.status, data: failureData } }, [token]).message,
              ),
            );
            if (response.status === 401 && !process.env.FLOWSTRIDE_TOKEN && fs.existsSync(activeCredentialsPath))
              fs.unlinkSync(activeCredentialsPath);
            forceOS = true;
          } else if (response.ok) {
            const data = await response.json();
            const tier = data.tier.toUpperCase();
            if (loadNativeConfig(process.cwd(), options).ci && fs.existsSync(nodeModulesPath)) {
              const workspaceResponse = await fetch(`${API_BASE}/api/workspace/status`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (!workspaceResponse.ok) forceOS = await handleOfflinePrompt();
              else {
                const workspaceData = await workspaceResponse.json();
                options.manifest = workspaceData.manifest;
                options.workspaceId = workspaceData.workspace?._id;
                options.isCloudSyncActive = true;
              }
            }


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

      const resolvedTargetPath = targetPath || loadNativeConfig(process.cwd(), options).testDir!;
      const strictUiFlowsDir = path.resolve(process.cwd(), resolvedTargetPath);

      if (!fs.existsSync(strictUiFlowsDir)) {
        console.error(`\n[ERROR]: Could not find ${strictUiFlowsDir}.`);
        console.error(
          `Flowstride requires all UI tests to be inside a valid directory.`,
        );
        process.exit(1);
      }

      options.forceOS = forceOS;
      if (!forceOS && token) {
        options.machineToken = token;
        const file = fs.existsSync(localCredentialsPath) ? localCredentialsPath : globalCredentialsPath;
        if (!options.workspaceId && fs.existsSync(file)) options.workspaceId = JSON.parse(fs.readFileSync(file, 'utf8')).workspaceId;
      }
      await runAction(strictUiFlowsDir, options);
    },
  );

async function handleOfflinePrompt(): Promise<boolean> {
  console.log(
    chalk.yellow(
      "🛜 OFFLINE: Unable to reach Flowstride Cloud. Enterprise Sync paused.",
    ),
  );

  if (process.env.CI || process.env.FLOWSTRIDE_NATIVE_CI || process.env.FLOWSTRIDE_TOKEN) {
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

program.command('install')
  .description('Install browsers matching this Flowstride engine')
  .argument('[browsers...]', 'chromium, firefox, or webkit')
  .option('--with-deps', 'Install operating-system browser dependencies')
  .action((browsers: string[], options: { withDeps?: boolean }) => {
    if (browsers.some(browser => !['chromium','firefox','webkit'].includes(browser))) throw new Error('Unknown browser.');
    const { execFileSync } = require('node:child_process');
    execFileSync(process.execPath, [path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js'), 'install', ...(options.withDeps ? ['--with-deps'] : []), ...(browsers.length ? browsers : ['chromium'])], { stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_GC: '1' } });
    console.log(`[Browsers]: Matching binaries installed: ${(browsers.length ? browsers : ['chromium']).join(', ')}. Use run --browser <engine> to select one.`);
  });

program.command('ci')
  .description('Set up native Flowstride CI')
  .command('init <provider>')
  .description('Generate a GitHub Actions workflow without overwriting existing files')
  .option('--browsers <names>', 'Comma-separated browser matrix', 'chromium')
  .option('--shards <total>', 'Number of CI machines per browser', '1')
  .action((provider: string, options: { browsers?: string; shards?: string }) => initCI(provider, options));

program.command('merge <summaries...>')
  .description('Merge complete native shard results and evidence')
  .option('--output <directory>', 'New project directory for merged results', 'flowstride-merged')
  .action((summaries: string[], options: { output: string }) => { const result = mergeResults(summaries, options.output); console.log(`Merged Flowstride result: ${result.status}`); process.exitCode = result.status === 'passed' ? 0 : 1; });
program.command('trace <file>')
  .description('Open a local Playwright trace without uploading it')
  .action((file: string) => { const { execFileSync } = require('node:child_process'); const local = projectPath(process.cwd(), file); execFileSync(process.execPath, [path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js'), 'show-trace', local], { stdio: 'inherit' }); });
program.parse(process.argv);

import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

export async function reportAction() {
  console.log("📊 Flowstride: Launching Debug Dashboard...");

  const targetProjectPath = process.cwd();
  const latestReportPath = path.join(targetProjectPath, "reports", "latest");

  const cliInstallPath = path.resolve(__dirname, "../../..");
  const reportPackagePath = path.join(
    cliInstallPath,
    "packages",
    "flowstride_report",
  );
  const publicPath = path.join(reportPackagePath, "public");

  const runDataPath = path.join(latestReportPath, "run-data.json");
  if (!fs.existsSync(runDataPath)) {
    console.error(
      '❌ Error: No run data found. Run "flowstride run" first to generate a report.',
    );
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
      fs.copyFileSync(
        path.join(sourceScreenshots, file),
        path.join(targetScreenshots, file),
      );
    }
    console.log(`📸 Synced ${files.length} screenshots to dashboard.`);
  }

  try {
    console.log("Serving report at http://localhost:5173...");
    execSync("npm run dev", {
      cwd: reportPackagePath,
      stdio: "inherit",
    });
  } catch (error) {
    console.error("❌ CLI Error: Could not launch report dashboard.");
  }
}

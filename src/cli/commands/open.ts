import chalk from "chalk";
import { startManualWorkspaceServer } from "../manual_server/workspace_server";

export async function openAction() {
  console.log(
    chalk.cyan(
      "\n🎨 Flowstride: Launching Local Manual Test Design Workspace...",
    ),
  );

  await startManualWorkspaceServer();
}

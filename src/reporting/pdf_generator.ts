import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright";

export class PdfGenerator {
  public async generateTestcasePdf(
    data: any,
    customOutputPath?: string,
  ): Promise<string> {
    let outputDir = "";

    if (customOutputPath) {
      outputDir = customOutputPath;
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
    } else {
      outputDir = path.join(process.cwd(), ".flowstride", "artifacts");
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
    }

    const fileName = `Flowstride_Test_Log_${Date.now()}.pdf`;
    const pdfPath = path.join(outputDir, fileName);

    const htmlContent = this.generateReportHtml(data);

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.setContent(htmlContent, { waitUntil: "networkidle" });

    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: { top: "30px", right: "30px", bottom: "30px", left: "30px" },
    });

    await browser.close();

    return pdfPath;
  }

  private generateReportHtml(data: any): string {
    let scenariosToProcess: any[] = [];

    if (data && data.files && Array.isArray(data.files)) {
      data.files.forEach((fileObj: any) => {
        if (fileObj.scenarios && Array.isArray(fileObj.scenarios)) {
          scenariosToProcess.push(...fileObj.scenarios);
        }
      });
    } else if (Array.isArray(data)) {
      scenariosToProcess = data;
    }

    const groupedScenarios: Record<string, any[]> = {};
    scenariosToProcess.forEach((scenario) => {
      const key = scenario.fileName || "General";
      if (!groupedScenarios[key]) groupedScenarios[key] = [];
      groupedScenarios[key].push(scenario);
    });

    let totalSteps = 0;
    let passedSteps = 0;
    let failedSteps = 0;
    let tablesHtml = "";

    for (const [fileName, fileScenarios] of Object.entries(groupedScenarios)) {
      const flatSteps = fileScenarios.flatMap((s) => s.steps || []);

      let fileRows = "";
      flatSteps.forEach((step: any, idx: number) => {
        totalSteps++;
        const status = (step.status || "PENDING").toUpperCase();

        const isSuccess =
          status === "PASS" || status === "PASSED" || status === "SUCCESS";
        const isFail = status === "FAILED" || status === "FAIL";

        if (isSuccess) passedSteps++;
        else if (isFail) failedSteps++;

        const color = isSuccess ? "#10b981" : isFail ? "#ef4444" : "#64748b";
        const actualResultText = isFail
          ? "Validation Failed"
          : "Action verified successfully.";
        const actualResultColor = isFail ? "#ef4444" : "#64748b";

        fileRows += `
          <tr>
            <td style="padding: 16px 14px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-weight: 500; width: 50px;">${idx + 1}</td>
            <td style="padding: 16px 14px; border-bottom: 1px solid #e2e8f0; font-weight: 700; color: #1e293b;">${step.command || "action"}</td>
            <td style="padding: 16px 14px; border-bottom: 1px solid #e2e8f0; color: #475569; font-style: italic;">${step.type || ""} ${step.description || "-"}</td>
            <td style="padding: 16px 14px; border-bottom: 1px solid #e2e8f0; color: ${actualResultColor};">${actualResultText}</td>
            <td style="padding: 16px 14px; border-bottom: 1px solid #e2e8f0; font-weight: 900; font-size: 10px; color: ${color};">${status}</td>
          </tr>
        `;
      });

      tablesHtml += `
        <div class="file-separator">
          <span>📄 ${fileName.toUpperCase()}</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>S/N</th>
              <th>Action</th>
              <th>Expected Result</th>
              <th>Actual Result</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${fileRows || '<tr><td colspan="5" style="text-align:center;padding:20px;color:#64748b;">No test steps recorded.</td></tr>'}
          </tbody>
        </table>
      `;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 20px; color: #1e293b; }
          .header { border-bottom: 4px solid #0f172a; padding-bottom: 24px; margin-bottom: 40px; }
          .title { font-size: 36px; font-weight: 900; text-transform: uppercase; margin: 0 0 8px 0; color: #0f172a; }
          .subtitle { font-size: 14px; color: #64748b; font-weight: 500; margin: 0; }
          .summary { display: flex; gap: 15px; margin-bottom: 20px; }
          .stat-box { padding: 15px; border-radius: 8px; background: #f8fafc; flex: 1; text-align: center; border: 1px solid #e2e8f0; }
          .stat-value { font-size: 22px; font-weight: bold; }
          
          .file-separator { text-align: center; margin: 50px 0 20px 0; border-bottom: 1px solid rgba(124, 58, 237, 0.3); line-height: 0.1em; }
          .file-separator span { background: #fff; padding: 0 15px; color: #7c3aed; font-weight: 900; font-size: 11px; letter-spacing: 0.1em; }
          
          table { width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; font-size: 13px; }
          th { background: #0f172a; color: white; text-align: left; padding: 14px; font-weight: 600; font-size: 11px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1 class="title">Test Case Log</h1>
          <p class="subtitle">Project: Flowstride Community Edition</p>
        </div>
        <div class="summary">
          <div class="stat-box">
            <div class="stat-value" style="color: #1e293b;">${totalSteps}</div>
            <div style="font-size:10px;color:#64748b;text-transform:uppercase;margin-top:4px;font-weight:700;">Total Steps</div>
          </div>
          <div class="stat-box">
            <div class="stat-value" style="color:#10b981;">${passedSteps}</div>
            <div style="font-size:10px;color:#64748b;text-transform:uppercase;margin-top:4px;font-weight:700;">Passed</div>
          </div>
          <div class="stat-box">
            <div class="stat-value" style="color:#ef4444;">${failedSteps}</div>
            <div style="font-size:10px;color:#64748b;text-transform:uppercase;margin-top:4px;font-weight:700;">Failed</div>
          </div>
        </div>
        
        ${tablesHtml}

      </body>
      </html>
    `;
  }
}

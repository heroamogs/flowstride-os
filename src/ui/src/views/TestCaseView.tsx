import { ClipboardCheck, Printer, FileCode } from "lucide-react";
import { useFlowStore } from "../store";
import { sendToRunner } from "../socket";

export const TestCaseView = () => {
  const { testScenarios } = useFlowStore();

  const grouped = testScenarios.reduce((acc: any, scenario) => {
    const key = scenario.fileName || "General";
    if (!acc[key]) acc[key] = [];
    acc[key].push(scenario);
    return acc;
  }, {});

  if (testScenarios.length === 0)
    return (
      <div
        style={{
          display: "flex",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          color: "#64748b",
        }}
      >
        Awaiting test data...
      </div>
    );

  const handleExportClick = () => {
    sendToRunner("EXPORT_PDF_REQ", testScenarios);
  };

  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        backgroundColor: "white",
        overflowY: "auto",
        color: "#1e293b",
      }}
    >
      <div
        style={{
          position: "sticky",
          top: 0,
          backgroundColor: "#f8fafc",
          borderBottom: "1px solid #e2e8f0",
          padding: "16px 40px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontWeight: "700",
          }}
        >
          <ClipboardCheck color="#7c3aed" /> Test Case Documentation
        </div>
        <button
          onClick={handleExportClick}
          style={{
            padding: "8px 16px",
            borderRadius: "6px",
            border: "1px solid #cbd5e1",
            backgroundColor: "white",
            fontSize: "13px",
            fontWeight: "600",
            cursor: "pointer",
          }}
        >
          <Printer
            size={14}
            style={{ verticalAlign: "middle", marginRight: "8px" }}
          />{" "}
          Export PDF
        </button>
      </div>

      <div
        style={{ maxWidth: "900px", margin: "40px auto", padding: "0 20px" }}
      >
        {/* Main Title */}
        <div
          style={{
            borderBottom: "4px solid #0f172a",
            paddingBottom: "24px",
            marginBottom: "40px",
          }}
        >
          <h2
            style={{
              fontSize: "36px",
              fontWeight: "900",
              textTransform: "uppercase",
              margin: 0,
            }}
          >
            Test Case Log
          </h2>
          <p
            style={{ color: "#64748b", fontWeight: "500", margin: "8px 0 0 0" }}
          >
            Project: Flowstride Community Edition
          </p>
        </div>

        {Object.keys(grouped).map((fileName) => {
          const flatSteps = grouped[fileName].flatMap(
            (scenario: any) => scenario.steps,
          );

          return (
            <div key={fileName} style={{ marginBottom: "60px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "15px",
                  marginBottom: "25px",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    borderTop: "1px solid #7c3aed",
                    opacity: 0.3,
                  }}
                ></div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    color: "#7c3aed",
                    fontWeight: "900",
                    fontSize: "11px",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                  }}
                >
                  <FileCode size={14} /> {fileName}
                </div>
                <div
                  style={{
                    flex: 1,
                    borderTop: "1px solid #7c3aed",
                    opacity: 0.3,
                  }}
                ></div>
              </div>

              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  overflow: "hidden",
                }}
              >
                <thead style={{ backgroundColor: "#0f172a", color: "white" }}>
                  <tr>
                    {[
                      "S/N",
                      "Action",
                      "Expected Result",
                      "Actual Result",
                      "Status",
                    ].map((h, i) => (
                      <th
                        key={i}
                        style={{
                          padding: "14px",
                          fontSize: "11px",
                          textAlign: "left",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {flatSteps.map((step: any, index: number) => {
                    const isFail = step.status === "failed";
                    const serialNumber = index + 1;

                    return (
                      <tr
                        key={step.id}
                        style={{ borderBottom: "1px solid #e2e8f0" }}
                      >
                        <td
                          style={{
                            padding: "16px 14px",
                            fontSize: "13px",
                            color: "#64748b",
                            fontWeight: "500",
                            width: "50px",
                          }}
                        >
                          {serialNumber}
                        </td>
                        <td
                          style={{
                            padding: "16px 14px",
                            fontWeight: "700",
                            fontSize: "13px",
                          }}
                        >
                          {step.command}
                        </td>
                        <td
                          style={{
                            padding: "16px 14px",
                            fontSize: "13px",
                            color: "#475569",
                            fontStyle: "italic",
                          }}
                        >
                          {step.type} {step.description}
                        </td>
                        <td
                          style={{
                            padding: "16px 14px",
                            fontSize: "13px",
                            color: isFail ? "#ef4444" : "#64748b",
                          }}
                        >
                          {isFail
                            ? "Validation Failed"
                            : "Action verified successfully."}
                        </td>
                        <td style={{ padding: "16px 14px", textAlign: "left" }}>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: "900",
                              color: isFail ? "#ef4444" : "#10b981",
                            }}
                          >
                            {(step.status || "PENDING").toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
};

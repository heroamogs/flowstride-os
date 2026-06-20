import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  FileText,
  ChevronRight,
  Terminal,
  X,
  FileCode,
} from "lucide-react";
import { useFlowStore } from "../store";

export const ReportsView = () => {
  const [selectedStep, setSelectedStep] = useState<any>(null);
  const { testScenarios, logs } = useFlowStore();

  const totalSteps = testScenarios.reduce(
    (acc, sc) => acc + sc.steps.length,
    0,
  );
  const passedSteps = testScenarios.reduce(
    (acc, sc) =>
      acc +
      sc.steps.filter((st) => ["pass", "passed", "success"].includes(st.status))
        .length,
    0,
  );
  const failedSteps = testScenarios.reduce(
    (acc, sc) => acc + sc.steps.filter((st) => st.status === "failed").length,
    0,
  );

  const grouped = testScenarios.reduce((acc: any, scenario) => {
    const key = scenario.fileName || "General";
    if (!acc[key]) acc[key] = [];
    acc[key].push(scenario);
    return acc;
  }, {});

  let actualOutcome = "Verified.";
  let networkData = null;
  let stepScreenshot = null;
  let stepBoundingBox = null;

  if (selectedStep) {
    const isFailed = selectedStep.status === "failed";
    const isPass = ["pass", "passed", "success"].includes(selectedStep.status);

    stepScreenshot = selectedStep.screenshot;

    if (isFailed) {
      const expectedContext = `${selectedStep.type} ${selectedStep.description}`;
      const errorLog = logs
        .slice()
        .reverse()
        .find(
          (l) =>
            l.type === "ERROR" &&
            l.fileName === selectedStep.fileName &&
            l.stepContext === expectedContext,
        );

      actualOutcome = errorLog ? errorLog.summary : "Validation Failed.";

      if (!stepScreenshot && errorLog?.details?.screenshot) {
        stepScreenshot = errorLog.details.screenshot;
      }
      if (errorLog?.details?.boundingBox) {
        stepBoundingBox = errorLog.details.boundingBox;
      }
    } else if (selectedStep.status === "running") {
      actualOutcome = "Executing...";
    } else if (isPass) {
      actualOutcome = "Action verified successfully.";
    }

    const networkLog = logs
      .slice()
      .reverse()
      .find(
        (l) =>
          (l.type === "REST" || l.type === "GRAPHQL") &&
          l.fileName === selectedStep.fileName,
      );
    networkData = networkLog ? networkLog.details : null;
  }

  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        backgroundColor: "#f8fafc",
        overflowY: "auto",
        position: "relative",
        color: "#0f172a",
      }}
    >
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "40px 20px",
          marginRight: selectedStep ? "450px" : "auto",
          transition: "margin-right 0.3s",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            borderBottom: "1px solid #e2e8f0",
            paddingBottom: "24px",
            marginBottom: "40px",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "30px",
                fontWeight: "800",
                margin: 0,
                color: "#1e293b",
              }}
            >
              Flowstride Reports
            </h1>
            <p
              style={{
                color: "#64748b",
                margin: "4px 0 0 0",
                fontWeight: "500",
              }}
            >
              Multi-Flow Execution Analysis
            </p>
          </div>
          <div style={{ display: "flex", gap: "16px" }}>
            <StatCard
              label="PASSED"
              value={passedSteps}
              color="#10b981"
              icon={<CheckCircle2 size={20} />}
            />
            <StatCard
              label="FAILED"
              value={failedSteps}
              color="#ef4444"
              icon={<XCircle size={20} />}
            />
            <StatCard
              label="TOTAL"
              value={totalSteps}
              color="#3b82f6"
              icon={<FileText size={20} />}
            />
          </div>
        </header>

        {Object.keys(grouped).map((fileName) => (
          <div key={fileName} style={{ marginBottom: "60px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "20px",
                marginBottom: "24px",
              }}
            >
              <div
                style={{
                  height: "2px",
                  flex: 1,
                  backgroundColor: "#7c3aed",
                  opacity: 0.15,
                }}
              ></div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  color: "#7c3aed",
                  fontWeight: "900",
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  backgroundColor: "rgba(124, 58, 237, 0.05)",
                  padding: "6px 16px",
                  borderRadius: "20px",
                  border: "1px solid rgba(124, 58, 237, 0.1)",
                }}
              >
                <FileCode size={14} /> {fileName}
              </div>
              <div
                style={{
                  height: "2px",
                  flex: 1,
                  backgroundColor: "#7c3aed",
                  opacity: 0.15,
                }}
              ></div>
            </div>

            <div
              style={{
                backgroundColor: "white",
                borderRadius: "12px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                overflow: "hidden",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  textAlign: "left",
                }}
              >
                <thead
                  style={{
                    backgroundColor: "#f1f5f9",
                    borderBottom: "1px solid #e2e8f0",
                  }}
                >
                  <tr>
                    {["S/N", "Scenario", "Action", "Status", ""].map((h, i) => (
                      <th
                        key={i}
                        style={{
                          padding: "16px 24px",
                          fontSize: "10px",
                          fontWeight: "800",
                          color: "#64748b",
                          textTransform: "uppercase",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grouped[fileName].flatMap((scenario: any) =>
                    scenario.steps.map((step: any, idx: number) => (
                      <tr
                        key={step.id}
                        onClick={() =>
                          setSelectedStep({
                            ...step,
                            scenarioName: scenario.name,
                            fileName,
                          })
                        }
                        style={{
                          cursor: "pointer",
                          borderBottom: "1px solid #f1f5f9",
                          backgroundColor:
                            selectedStep?.id === step.id
                              ? "#eff6ff"
                              : "transparent",
                        }}
                      >
                        <td
                          style={{
                            padding: "18px 24px",
                            fontSize: "12px",
                            color: "#94a3b8",
                            fontFamily: "monospace",
                            fontWeight: "bold",
                          }}
                        >
                          {idx + 1}
                        </td>
                        <td
                          style={{
                            padding: "18px 24px",
                            fontWeight: "600",
                            color: "#334155",
                          }}
                        >
                          {scenario.name}
                        </td>
                        <td
                          style={{
                            padding: "18px 24px",
                            fontSize: "14px",
                            color: "#475569",
                          }}
                        >
                          <b style={{ color: "#7c3aed", marginRight: "8px" }}>
                            {step.type}
                          </b>{" "}
                          {step.description}
                        </td>
                        <td style={{ padding: "18px 24px" }}>
                          <StatusBadge status={step.status} />
                        </td>
                        <td
                          style={{ padding: "18px 24px", textAlign: "right" }}
                        >
                          <ChevronRight
                            size={16}
                            color={
                              selectedStep?.id === step.id
                                ? "#3b82f6"
                                : "#cbd5e1"
                            }
                            style={{
                              transform:
                                selectedStep?.id === step.id
                                  ? "rotate(90deg)"
                                  : "none",
                              transition: "0.2s",
                            }}
                          />
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <aside
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100%",
          width: "450px",
          backgroundColor: "white",
          boxShadow: "-10px 0 40px rgba(0,0,0,0.1)",
          borderLeft: "1px solid #e2e8f0",
          zIndex: 100,
          transform: selectedStep ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          padding: "30px",
          overflowY: "auto",
        }}
      >
        {selectedStep && (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "32px",
              }}
            >
              <h2
                style={{
                  fontSize: "18px",
                  fontWeight: "700",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                <Terminal size={18} color="#3b82f6" /> Step Diagnostics
              </h2>
              <X
                onClick={() => setSelectedStep(null)}
                style={{ cursor: "pointer", color: "#94a3b8" }}
              />
            </div>

            {stepScreenshot && (
              <Section
                label={`Visual State (${(selectedStep.status || "").toUpperCase()})`}
              >
                <ErrorScreenshot
                  screenshot={stepScreenshot}
                  boundingBox={stepBoundingBox}
                />
              </Section>
            )}

            <Section label="Context">
              <div style={{ fontWeight: "bold", color: "#1e293b" }}>
                {selectedStep.scenarioName}
              </div>
            </Section>

            <Section label="Requirement Proof">
              <div
                style={{
                  padding: "16px",
                  backgroundColor: "#f8fafc",
                  borderRadius: "8px",
                  fontSize: "14px",
                  fontStyle: "italic",
                  color: "#475569",
                  border: "1px solid #f1f5f9",
                }}
              >
                "{selectedStep.type} {selectedStep.description}"
              </div>
            </Section>

            <Section label="Runtime Outcome">
              <div
                style={{
                  padding: "16px",
                  borderRadius: "8px",
                  fontSize: "14px",
                  fontWeight: "500",
                  backgroundColor: ["pass", "success", "passed"].includes(
                    selectedStep.status,
                  )
                    ? "#ecfdf5"
                    : "#fef2f2",
                  color: ["pass", "success", "passed"].includes(
                    selectedStep.status,
                  )
                    ? "#065f46"
                    : "#991b1b",
                  border: `1px solid ${["pass", "success", "passed"].includes(selectedStep.status) ? "#d1fae5" : "#fee2e2"}`,
                }}
              >
                {actualOutcome}
              </div>
            </Section>

            {networkData && (
              <Section label="Network Activity">
                <div
                  style={{
                    backgroundColor: "#0f172a",
                    padding: "16px",
                    borderRadius: "8px",
                    color: "#7dd3fc",
                    fontFamily: "monospace",
                    fontSize: "11px",
                    overflowX: "auto",
                  }}
                >
                  <pre>
                    {JSON.stringify(
                      {
                        status: networkData.responseStatus,
                        url: networkData.url,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </div>
              </Section>
            )}
          </>
        )}
      </aside>
    </div>
  );
};

const ErrorScreenshot = ({ screenshot, boundingBox }: any) => {
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleEnlarge = () => {
    const newTab = window.open();
    if (newTab) {
      newTab.document.write(`
        <html>
          <head><title>Step Screenshot</title></head>
          <body style="margin: 0; background-color: #0f172a; display: flex; justify-content: center; padding: 40px; font-family: sans-serif;">
            <div style="position: relative; display: inline-block;">
              <img src="data:image/jpeg;base64,${screenshot}" style="max-width: 100%; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);" />
              ${
                boundingBox
                  ? `<div style="
                      position: absolute;
                      border: 3px solid #ef4444;
                      background-color: rgba(239, 68, 68, 0.2);
                      left: ${(boundingBox.x / imgSize.w) * 100}%;
                      top: ${(boundingBox.y / imgSize.h) * 100}%;
                      width: ${(boundingBox.width / imgSize.w) * 100}%;
                      height: ${(boundingBox.height / imgSize.h) * 100}%;
                      box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.5);
                      pointer-events: none;
                    "></div>`
                  : ""
              }
            </div>
          </body>
        </html>
      `);
      newTab.document.close();
    }
  };

  return (
    <div
      onClick={handleEnlarge}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: "relative",
        width: "100%",
        borderRadius: "8px",
        overflow: "hidden",
        border: "1px solid #e2e8f0",
        backgroundColor: "#0f172a",
        cursor: "zoom-in",
      }}
    >
      <img
        src={`data:image/jpeg;base64,${screenshot}`}
        style={{
          width: "100%",
          display: "block",
          opacity: isHovered ? 0.6 : 1,
          transition: "opacity 0.2s ease",
        }}
        onLoad={(e) =>
          setImgSize({
            w: e.currentTarget.naturalWidth,
            h: e.currentTarget.naturalHeight,
          })
        }
        alt="Step snapshot"
      />

      {boundingBox && imgSize.w > 0 && (
        <div
          style={{
            position: "absolute",
            border: "2px solid #ef4444",
            backgroundColor: "rgba(239, 68, 68, 0.2)",
            left: `${(boundingBox.x / imgSize.w) * 100}%`,
            top: `${(boundingBox.y / imgSize.h) * 100}%`,
            width: `${(boundingBox.width / imgSize.w) * 100}%`,
            height: `${(boundingBox.height / imgSize.h) * 100}%`,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.5)",
            zIndex: 10,
            pointerEvents: "none",
          }}
        />
      )}

      {isHovered && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            backgroundColor: "rgba(15, 23, 42, 0.9)",
            color: "white",
            padding: "8px 16px",
            borderRadius: "20px",
            fontSize: "12px",
            fontWeight: "bold",
            pointerEvents: "none",
            zIndex: 20,
          }}
        >
          Click to Enlarge
        </div>
      )}
    </div>
  );
};

const StatCard = ({ label, value, color, icon }: any) => (
  <div
    style={{
      backgroundColor: "white",
      padding: "16px 24px",
      borderRadius: "10px",
      border: "1px solid #e2e8f0",
      minWidth: "140px",
      display: "flex",
      alignItems: "center",
      gap: "12px",
    }}
  >
    <div
      style={{
        color,
        backgroundColor: `${color}15`,
        padding: "8px",
        borderRadius: "8px",
      }}
    >
      {icon}
    </div>
    <div>
      <div style={{ fontSize: "20px", fontWeight: "800" }}>{value}</div>
      <div style={{ fontSize: "9px", fontWeight: "800", color: "#94a3b8" }}>
        {label}
      </div>
    </div>
  </div>
);

const StatusBadge = ({ status }: { status: string }) => {
  const isPass = ["pass", "passed", "success"].includes(status);
  const isFail = status === "failed";
  return (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: "20px",
        fontSize: "10px",
        fontWeight: "800",
        border: "1px solid",
        backgroundColor: isPass ? "#dcfce7" : isFail ? "#fee2e2" : "#dbeafe",
        color: isPass ? "#15803d" : isFail ? "#b91c1c" : "#1d4ed8",
        borderColor: isPass ? "#bbf7d0" : isFail ? "#fecaca" : "#bfdbfe",
      }}
    >
      {(status || "PENDING").toUpperCase()}
    </span>
  );
};

const Section = ({ label, children }: any) => (
  <div style={{ marginBottom: "24px" }}>
    <h3
      style={{
        fontSize: "11px",
        fontWeight: "800",
        color: "#94a3b8",
        textTransform: "uppercase",
        marginBottom: "8px",
        letterSpacing: "0.05em",
      }}
    >
      {label}
    </h3>
    {children}
  </div>
);

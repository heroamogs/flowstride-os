import { useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Home,
  Lock,
  Globe,
  Monitor,
  Smartphone,
  Tablet,
  Camera,
  Eye,
} from "lucide-react";
import { useFlowStore } from "../store";

export const BrowserView = () => {
  const {
    currentUrls,
    pageTitles,
    browserFrames,
    testScenarios,
    activeStepId,
    setActiveStepId,
    isRunning,
    activeTestFile,
    setActiveTestFile,
  } = useFlowStore();

  useEffect(() => {
    if (isRunning) {
      const runningScenario = testScenarios.find((s) =>
        s.steps.some((step) => step.status === "running"),
      );

      if (runningScenario && runningScenario.fileName !== activeTestFile) {
        setActiveTestFile(runningScenario.fileName);
      }
    }
  }, [testScenarios, isRunning, activeTestFile, setActiveTestFile]);

  let targetFileName: string | null = isRunning ? activeTestFile : null;
  let targetStepId: string | null = activeStepId;

  if (activeStepId && activeStepId.includes(":::")) {
    const parts = activeStepId.split(":::");
    targetFileName = parts[0];
    targetStepId = parts[1];
  }

  const selectedStep = testScenarios
    .filter(
      (scenario) => !targetFileName || scenario.fileName === targetFileName,
    )
    .flatMap((scenario) => scenario.steps)
    .find((step) => step.id === targetStepId);

  const hasHistoricalSnapshot =
    !isRunning && !!(selectedStep && selectedStep.screenshot);

  const activeUrl = currentUrls[activeTestFile] || "about:blank";
  const activeTitle = pageTitles[activeTestFile] || "New Tab";
  const activeFrame = browserFrames[activeTestFile] || null;

  const visualSource = hasHistoricalSnapshot
    ? selectedStep.screenshot
    : activeFrame;

  const uniqueFiles = Array.from(new Set(testScenarios.map((s) => s.fileName)));

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#1c2128",
      }}
    >
      <div
        onWheel={(e) => {
          e.currentTarget.scrollLeft += e.deltaY;
        }}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "8px 8px 0 8px",
          gap: "4px",
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        <style>
          {`
            div::-webkit-scrollbar { display: none; }
          `}
        </style>

        {uniqueFiles.length > 0 ? (
          uniqueFiles.map((file, idx) => {
            const isActive = activeTestFile === file;
            return (
              <div
                key={idx}
                onClick={() => setActiveTestFile(file)}
                style={{
                  backgroundColor: isActive
                    ? "var(--fs-bg-base)"
                    : "rgba(255,255,255,0.05)",
                  padding: "6px 15px",
                  borderRadius: "8px 8px 0 0",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  border: isActive
                    ? "1px solid var(--fs-border)"
                    : "1px solid transparent",
                  borderBottom: "none",
                  minWidth: "130px",
                  maxWidth: "200px",
                  flexShrink: 0,
                  cursor: "pointer",
                  opacity: isActive ? 1 : 0.6,
                }}
              >
                <Globe
                  size={12}
                  color={isActive ? "var(--fs-accent-purple)" : "#8b949e"}
                  style={{ flexShrink: 0 }}
                />
                <span
                  style={{
                    fontSize: "10px",
                    color: isActive ? "white" : "#8b949e",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    fontWeight: isActive ? "bold" : "normal",
                  }}
                >
                  {file}
                </span>
              </div>
            );
          })
        ) : (
          <div
            style={{
              backgroundColor: "var(--fs-bg-base)",
              padding: "6px 15px",
              borderRadius: "8px 8px 0 0",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              border: "1px solid var(--fs-border)",
              borderBottom: "none",
              minWidth: "140px",
              flexShrink: 0,
            }}
          >
            <Globe size={12} color="var(--fs-accent-purple)" />
            <span style={{ fontSize: "10px", color: "white" }}>
              {activeTitle}
            </span>
          </div>
        )}
      </div>

      <div
        style={{
          backgroundColor: "var(--fs-bg-base)",
          borderTop: "1px solid var(--fs-border)",
          padding: "6px 12px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", gap: "8px", color: "#8b949e" }}>
          <ChevronLeft size={14} />
          <ChevronRight size={14} />
          <RotateCcw size={14} />
          <Home size={14} />
        </div>

        <div
          style={{
            flex: 1,
            backgroundColor: "#05070a",
            border: "1px solid var(--fs-border)",
            borderRadius: "15px",
            padding: "3px 12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <Lock size={10} color="#22c55e" />
          <span
            style={{
              fontSize: "10px",
              color: "#8b949e",
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            {activeUrl}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            gap: "10px",
            color: "#444",
            borderLeft: "1px solid #333",
            paddingLeft: "12px",
          }}
        >
          <Monitor size={14} color="var(--fs-accent-purple)" />
          <Tablet size={14} />
          <Smartphone size={14} />
          <Camera size={14} />
        </div>
      </div>

      <div
        style={{
          flex: 1,
          margin: "10px",
          backgroundColor: "white",
          borderRadius: "4px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {hasHistoricalSnapshot && (
          <div
            style={{
              position: "absolute",
              top: "12px",
              left: "12px",
              right: "12px",
              backgroundColor: "rgba(15, 23, 42, 0.95)",
              border: "1px solid rgba(167, 139, 250, 0.3)",
              padding: "10px 16px",
              borderRadius: "6px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              zIndex: 30,
              boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
              backdropFilter: "blur(4px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                style={{
                  backgroundColor: "rgba(167, 139, 250, 0.1)",
                  padding: "6px",
                  borderRadius: "4px",
                }}
              >
                <Eye size={14} color="#a78bfa" />
              </div>
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: "bold",
                    color: "#a78bfa",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Viewing Historical State
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "#e2e8f0",
                    fontFamily: "monospace",
                    marginTop: "2px",
                  }}
                >
                  {selectedStep?.command}
                </div>
              </div>
            </div>
            <button
              onClick={() => setActiveStepId(null)}
              style={{
                backgroundColor: "#7c3aed",
                color: "white",
                border: "none",
                padding: "6px 14px",
                borderRadius: "4px",
                fontSize: "11px",
                fontWeight: "bold",
                cursor: "pointer",
                transition: "background 0.2s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "#6d28d9")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "#7c3aed")
              }
            >
              Return to Live
            </button>
          </div>
        )}

        {visualSource ? (
          <img
            src={`data:image/png;base64,${visualSource}`}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              opacity: hasHistoricalSnapshot ? 0.95 : 1,
            }}
            alt="Browser frame"
          />
        ) : (
          <div style={{ textAlign: "center", color: "#ccc" }}>
            <Globe size={40} style={{ marginBottom: "8px", opacity: 0.1 }} />
            <div style={{ fontSize: "11px", fontWeight: 500, opacity: 0.3 }}>
              WAITING FOR RENDER...
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

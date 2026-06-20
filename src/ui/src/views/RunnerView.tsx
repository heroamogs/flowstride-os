import { BrowserView } from "../components/BrowserView";
import { NetworkPanel } from "../components/NetworkPanel";
import { ConsolePanel } from "../components/ConsolePanel";
import { useFlowStore } from "../store";

export const RunnerView = ({
  isRightPanelOpen,
}: {
  isRightPanelOpen: boolean;
}) => {
  const { logs, pageTitles, activeTestFile } = useFlowStore();
  const latestLog = logs[logs.length - 1];

  const activeTitle = pageTitles[activeTestFile] || "New Tab";

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--fs-bg-base)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "35px",
          backgroundColor: "#161b22",
          borderBottom: "1px solid var(--fs-border)",
          display: "flex",
          alignItems: "center",
          padding: "0 15px",
          fontSize: "11px",
          color: "#8b949e",
          flexShrink: 0,
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}
        >
          <span style={{ color: "#a78bfa", fontWeight: "bold" }}>LOG:</span>
          <span
            style={{
              color: "#c9d1d9",
              fontFamily: "monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {latestLog?.summary || "System ready. Awaiting connection..."}
          </span>
        </div>

        <div style={{ opacity: 0.5, fontStyle: "italic" }}>{activeTitle}</div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div
          style={{
            flex: 1,
            borderRight: "1px solid var(--fs-border)",
            height: "100%",
            overflow: "hidden",
          }}
        >
          <BrowserView />
        </div>

        <div
          style={{
            width: isRightPanelOpen ? "400px" : "0px",
            transition: "width 0.2s ease",
            display: "flex",
            flexDirection: "column",
            height: "100%",
            backgroundColor: "#0d1117",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              flex: 1,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <NetworkPanel />
          </div>

          <div
            style={{
              flex: 1,
              borderTop: "1px solid var(--fs-border)",
              backgroundColor: "#0d1117",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                padding: "8px 15px",
                fontSize: "11px",
                fontWeight: "bold",
                color: "#8b949e",
                borderBottom: "1px solid var(--fs-border)",
                flexShrink: 0,
              }}
            >
              LIVE INFO
            </div>
            <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
              <ConsolePanel />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

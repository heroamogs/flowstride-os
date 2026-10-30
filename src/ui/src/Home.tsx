import { ResizableFlowPanel } from "./components/ResizableFlowPanel";
import { DEFAULT_FLOW_PANEL_WIDTH } from "./utils/flowPanelSize";
import { useState } from "react";
import { useFlowStore } from "./store";

import { Sidebar } from "./components/Sidebar";
import { RunnerView } from "./views/RunnerView";
import { ReportsView } from "./views/ReportsView";
import { TestCaseView } from "./views/TestCaseView";
import { LogsView } from "./views/LogsView";
import { WorkspaceView } from "./views/WorkspaceView";
import { RunsView } from "./views/RunsView";
import { FlowList } from "./components/FlowList";
import { Header } from "./components/Header";

export default function Home() {
  const { activeView } = useFlowStore();
  const [isTestFlowsOpen, setTestFlowsOpen] = useState(true);
  const [testFlowsWidth, setTestFlowsWidth] = useState(DEFAULT_FLOW_PANEL_WIDTH);

  const [isRightPanelOpen, setRightPanelOpen] = useState(false);

  const renderWorkspace = () => {
    switch (activeView) {
      case "Workspace":
        return <WorkspaceView />;
      case "Runs":
        return <RunsView />;
      case "Flows":
        return (
          <>
            <ResizableFlowPanel
              isOpen={isTestFlowsOpen}
              preferredWidth={testFlowsWidth}
              onWidthChange={setTestFlowsWidth}
            >
              <FlowList />
            </ResizableFlowPanel>
            <main
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                height: "100vh",
                overflow: "hidden",
              }}
            >
              <Header
                isRightPanelOpen={isRightPanelOpen}
                onToggleRightPanel={() => setRightPanelOpen(!isRightPanelOpen)}
              />
              <div
                style={{ flex: 1, overflow: "hidden", position: "relative" }}
              >
                <RunnerView isRightPanelOpen={isRightPanelOpen} />
              </div>
            </main>
          </>
        );
      case "Logs":
        return <LogsView />;
      case "Reports":
        return <ReportsView />;
      case "TestCase":
        return <TestCaseView />;
      default:
        return (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#0b0e14",
            }}
          >
            <h2 style={{ color: "#8b949e" }}>
              {activeView} (Under Construction)
            </h2>
          </div>
        );
    }
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        width: "100vw",
        backgroundColor: "#0b0e14",
        color: "white",
        overflow: "hidden",
      }}
    >
      <Sidebar
        isTestFlowsOpen={isTestFlowsOpen}
        setTestFlowsOpen={setTestFlowsOpen}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          height: "100vh",
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        {renderWorkspace()}
      </div>
    </div>
  );
}

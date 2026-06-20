import {
  GitFork,
  ScrollText,
  FileText,
  ClipboardCheck,
  ListTree,
} from "lucide-react";
import { useFlowStore } from "../store";
import flowLogo from "../assets/flow_logo.png";

interface SidebarProps {
  isTestFlowsOpen: boolean;
  setTestFlowsOpen: (val: boolean) => void;
}

export const Sidebar = ({
  isTestFlowsOpen,
  setTestFlowsOpen,
}: SidebarProps) => {
  const { activeView, setActiveView } = useFlowStore();

  const navItems = [
    { id: "Flows", icon: GitFork, label: "Flows" },
    { id: "Logs", icon: ScrollText, label: "Logs" },
    { id: "Reports", icon: FileText, label: "Reports" },
    { id: "TestCase", icon: ClipboardCheck, label: "TestCase" },
  ];

  return (
    <nav
      style={{
        width: "75px",
        backgroundColor: "#0d1117",
        borderRight: "1px solid #30363d",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        flexShrink: 0,
        height: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{ padding: "25px 0", cursor: "pointer" }}
        onClick={() => setActiveView("Flows")}
      >
        <img
          src={flowLogo}
          alt="Flowstride"
          style={{ width: "42px", height: "auto" }}
        />
      </div>

      {activeView === "Flows" && (
        <div
          onClick={() => setTestFlowsOpen(!isTestFlowsOpen)}
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "12px 0",
            cursor: "pointer",
            color: isTestFlowsOpen ? "#a78bfa" : "#8b949e",
            borderBottom: "1px solid #21262d",
            marginBottom: "10px",
          }}
        >
          <ListTree size={22} />
          <span
            style={{ fontSize: "10px", marginTop: "4px", fontWeight: "bold" }}
          >
            {isTestFlowsOpen ? "Hide" : "Show"}
          </span>
        </div>
      )}

      <div style={{ flex: 1, width: "100%" }}>
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          return (
            <div
              key={item.id}
              onClick={() => setActiveView(item.id)}
              style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "18px 0",
                cursor: "pointer",
                backgroundColor: isActive
                  ? "rgba(124, 58, 237, 0.08)"
                  : "transparent",
                borderLeft: isActive
                  ? "3px solid #7c3aed"
                  : "3px solid transparent",
                color: isActive ? "#a78bfa" : "#8b949e",
                transition: "color 0.2s ease",
              }}
            >
              <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
              <span
                style={{
                  fontSize: "10px",
                  marginTop: "6px",
                  fontWeight: isActive ? "600" : "400",
                }}
              >
                {item.label}
              </span>
            </div>
          );
        })}
      </div>

      <a
        href="https://cloud.flowstride.io/register"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          padding: "25px 0",
          width: "100%",
          borderTop: "1px solid #30363d",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textDecoration: "none",
        }}
      >
        <div
          style={{
            width: "38px",
            height: "38px",
            borderRadius: "50%",
            border: "2px solid #30363d",
            backgroundColor: "#1f2937",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#a78bfa",
            fontWeight: "bold",
            fontSize: "14px",
          }}
        >
          OS
        </div>
        <span
          style={{
            fontSize: "11px",
            marginTop: "10px",
            fontWeight: "bold",
            color: "#ffffff",
          }}
        >
          Open Source
        </span>
        <span
          style={{
            fontSize: "9px",
            color: "#8b949e",
            marginTop: "2px",
            textAlign: "center",
            padding: "0 4px",
          }}
        >
          COMMUNITY EDITION
        </span>
      </a>
    </nav>
  );
};

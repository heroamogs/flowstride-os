import { useState } from "react";
import {
  Hand,
  MousePointer2,
  ListTree,
  Group,
  ArrowRight,
  Type,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Strictly defining the available tools based on your design screenshot
const WORKSPACE_TOOLS = [
  "Hand",
  "Select",
  "Step",
  "Group",
  "Arrow",
  "Text",
  "Requirement",
];

// Strictly map the tools to their corresponding secure Lucide components
const TOOL_ICONS: Record<string, LucideIcon> = {
  Hand: Hand,
  Select: MousePointer2,
  Step: ListTree,
  Group: Group,
  Arrow: ArrowRight,
  Text: Type,
  Requirement: ClipboardCheck,
};

// Strictly define the props required to communicate tool selection securely
interface ToolPaletteProps {
  activeTool: string;
  onToolSelect: (tool: string) => void;
}

export const ToolPalette = ({ activeTool, onToolSelect }: ToolPaletteProps) => {
  // STRICT MICRO-STEP: Local state to control the panel's visual width
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <aside
      style={{
        width: isExpanded ? "240px" : "64px",
        backgroundColor: "#ffffff",
        borderRight: "1px solid #e1e4e8",
        overflowY: "auto", // Strictly handled scrollbar on the parent container
        flexShrink: 0,
        transition: "width 0.2s ease", // Smooth layout interpolation
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Inner wrapper utilizing minHeight to enforce native scrolling and secure bottom padding */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          minHeight: "100%",
          padding: isExpanded ? "16px 16px 16px 16px" : "16px 8px 16px 8px",
          gap: "8px",
          flex: 1,
        }}
      >
        {/* STRICT MICRO-STEP: The Collapse Toggle Controller securely placed at the TOP */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: isExpanded ? "flex-end" : "center",
            padding: "4px 0",
            marginBottom: "16px",
            background: "transparent",
            border: "none",
            color: "#8c959f",
            cursor: "pointer",
            transition: "color 0.2s ease",
            width: "100%",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#24292f")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "#8c959f")}
          title={isExpanded ? "Collapse Palette" : "Expand Palette"}
        >
          {isExpanded ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>

        {WORKSPACE_TOOLS.map((tool) => {
          const isActive = activeTool === tool;
          const IconComponent = TOOL_ICONS[tool];

          // Handle a visual separator before "Requirement" based on your design
          if (tool === "Requirement") {
            return (
              <div key={tool} style={{ marginTop: "auto" }}>
                <div
                  style={{
                    height: "1px",
                    backgroundColor: "#e1e4e8",
                    margin: "16px 0",
                  }}
                />
                <button
                  onClick={() => onToolSelect(tool)}
                  title={!isExpanded ? tool : undefined}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: isExpanded ? "flex-start" : "center",
                    width: "100%",
                    padding: isExpanded ? "10px 12px" : "10px 0",
                    backgroundColor: isActive ? "#eef3fa" : "transparent",
                    color: isActive ? "#0969da" : "#24292f",
                    border: "none",
                    borderRadius: "8px",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: isActive ? "600" : "500",
                    transition: "all 0.2s ease",
                  }}
                >
                  <IconComponent
                    size={18}
                    style={{
                      marginRight: isExpanded ? "12px" : "0",
                      color: isActive ? "#0969da" : "#57606a",
                    }}
                  />
                  {isExpanded && tool}
                </button>
              </div>
            );
          }

          return (
            <button
              key={tool}
              onClick={() => onToolSelect(tool)}
              title={!isExpanded ? tool : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: isExpanded ? "flex-start" : "center",
                padding: isExpanded ? "10px 12px" : "10px 0",
                backgroundColor: isActive ? "#eef3fa" : "transparent",
                color: isActive ? "#0969da" : "#24292f",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: isActive ? "600" : "500",
                transition: "all 0.2s ease",
              }}
            >
              <IconComponent
                size={18}
                style={{
                  marginRight: isExpanded ? "12px" : "0",
                  color: isActive ? "#0969da" : "#57606a",
                }}
              />
              {isExpanded && tool}
            </button>
          );
        })}
      </div>
    </aside>
  );
};

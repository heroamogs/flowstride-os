import React, { useState, useEffect, useRef } from "react";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  CircleDashed,
  Loader2,
  Search,
} from "lucide-react";
import { useFlowStore } from "../store";

export const FlowList = () => {
  const {
    testScenarios,
    activeTestFile,
    activeStepId,
    setActiveStepId,
    isRunning,
  } = useFlowStore();

  const fileList = Array.from(
    new Set(testScenarios.map((s) => s.fileName)),
  ).filter(Boolean);

  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>(
    {},
  );
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeStepId) {
      const timer = setTimeout(() => {
        const activeElement = document.querySelector(
          '[data-active-step="true"]',
        );
        if (activeElement) {
          activeElement.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        }
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [activeStepId, activeTestFile]);

  useEffect(() => {
    if (isRunning) {
      const runningFile = testScenarios.find((s) =>
        s.steps.some((step) => step.status === "running"),
      )?.fileName;

      if (runningFile && runningFile !== expandedFile) {
        setExpandedFile(runningFile);
      }
    }
  }, [testScenarios, isRunning, expandedFile]);

  const total = fileList.length;
  let passed = 0;
  let failed = 0;

  fileList.forEach((fileName) => {
    const fileScenarios = testScenarios.filter((s) => s.fileName === fileName);
    const allSteps = fileScenarios.flatMap((s) => s.steps);

    if (allSteps.length > 0) {
      if (allSteps.some((s) => s.status === "failed")) {
        failed++;
      } else if (
        allSteps.every((s) => ["pass", "passed", "success"].includes(s.status))
      ) {
        passed++;
      }
    }
  });

  const toggleFile = (fileName: string) => {
    setExpandedFile(expandedFile === fileName ? null : fileName);
  };

  const toggleBlock = (blockId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedBlocks((prev) => ({ ...prev, [blockId]: !prev[blockId] }));
  };

  const getStatusIcon = (status: string, size = 14) => {
    switch (status) {
      case "pass":
      case "passed":
      case "success":
        return <CheckCircle2 size={size} color="#34d399" />;
      case "failed":
        return <XCircle size={size} color="#f87171" />;
      case "running":
        return <Loader2 size={size} color="#60a5fa" className="animate-spin" />;
      case "skipped":
        return <CircleDashed size={size} color="#6e7681" />;
      default:
        return <CircleDashed size={size} color="#8b949e" />;
    }
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#0d1117",
        borderRight: "1px solid #30363d",
      }}
    >
      <div
        style={{
          padding: "15px",
          borderBottom: "1px solid #30363d",
          flexShrink: 0,
        }}
      >
        <h2
          style={{
            fontSize: "12px",
            fontWeight: "bold",
            color: "#8b949e",
            margin: "0 0 12px 0",
          }}
        >
          TEST FLOWS
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "8px",
            marginBottom: "12px",
          }}
        >
          <div
            style={{
              backgroundColor: "#161b22",
              padding: "10px",
              borderRadius: "6px",
              border: "1px solid #30363d",
              textAlign: "center",
            }}
          >
            <div
              style={{ fontSize: "18px", fontWeight: "bold", color: "#c9d1d9" }}
            >
              {total}
            </div>
            <div
              style={{ fontSize: "10px", color: "#8b949e", marginTop: "2px" }}
            >
              TOTAL
            </div>
          </div>
          <div
            style={{
              backgroundColor: "rgba(52, 211, 153, 0.05)",
              padding: "10px",
              borderRadius: "6px",
              border: "1px solid rgba(52, 211, 153, 0.2)",
              textAlign: "center",
            }}
          >
            <div
              style={{ fontSize: "18px", fontWeight: "bold", color: "#34d399" }}
            >
              {passed}
            </div>
            <div
              style={{ fontSize: "10px", color: "#34d399", marginTop: "2px" }}
            >
              PASSED
            </div>
          </div>
          <div
            style={{
              backgroundColor: "rgba(248, 113, 113, 0.05)",
              padding: "10px",
              borderRadius: "6px",
              border: "1px solid rgba(248, 113, 113, 0.2)",
              textAlign: "center",
            }}
          >
            <div
              style={{ fontSize: "18px", fontWeight: "bold", color: "#f87171" }}
            >
              {failed}
            </div>
            <div
              style={{ fontSize: "10px", color: "#f87171", marginTop: "2px" }}
            >
              FAILED
            </div>
          </div>
        </div>
        <div style={{ position: "relative" }}>
          <Search
            size={14}
            style={{
              position: "absolute",
              left: "10px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "#8b949e",
            }}
          />
          <input
            placeholder="Search flows..."
            style={{
              width: "100%",
              backgroundColor: "#05070a",
              border: "1px solid #30363d",
              color: "#c9d1d9",
              fontSize: "11px",
              padding: "6px 10px 6px 30px",
              borderRadius: "4px",
            }}
          />
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "10px 0",
          scrollbarWidth: "thin",
        }}
      >
        {fileList.length === 0 && (
          <div
            style={{
              padding: "20px",
              textAlign: "center",
              color: "#8b949e",
              fontSize: "11px",
            }}
          >
            Awaiting execution...
          </div>
        )}

        {fileList.map((fileName) => {
          const isExpanded = expandedFile === fileName;

          const fileScenarios = testScenarios.filter(
            (s) => s.fileName === fileName,
          );
          const allSteps = fileScenarios.flatMap((s) => s.steps);

          let fileStatus = "pending";
          if (allSteps.length > 0) {
            if (allSteps.some((s) => s.status === "failed"))
              fileStatus = "failed";
            else if (allSteps.some((s) => s.status === "running"))
              fileStatus = "running";
            else if (
              allSteps.every((s) =>
                ["pass", "passed", "success"].includes(s.status),
              )
            )
              fileStatus = "pass";
          } else if (fileScenarios.some((s) => s.status === "running")) {
            fileStatus = "running";
          }

          type BlockType = {
            id: string;
            type: string;
            desc: string;
            status: string;
            steps: any[];
          };
          const blocks: BlockType[] = [];
          let currentBlock: BlockType | null = null;

          allSteps.forEach((step) => {
            const blockSignature = `${step.type}-${step.description || "Action"}`;
            if (!currentBlock || currentBlock.id !== blockSignature) {
              currentBlock = {
                id: blockSignature,
                type: step.type,
                desc: step.description,
                status: step.status,
                steps: [step],
              };
              blocks.push(currentBlock);
            } else {
              currentBlock.steps.push(step);
            }
          });

          blocks.forEach((block) => {
            if (block.steps.some((s) => s.status === "failed"))
              block.status = "failed";
            else if (block.steps.some((s) => s.status === "running"))
              block.status = "running";
            else if (
              block.steps.every((s) =>
                ["pass", "passed", "success"].includes(s.status),
              )
            )
              block.status = "pass";
            else block.status = "pending";
          });

          return (
            <div key={fileName} style={{ borderBottom: "1px solid #21262d" }}>
              <div
                onClick={() => toggleFile(fileName)}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor =
                    "rgba(124, 58, 237, 0.05)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = isExpanded
                    ? "rgba(124, 58, 237, 0.05)"
                    : "transparent")
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "12px 15px",
                  cursor: "pointer",
                  backgroundColor: isExpanded
                    ? "rgba(124, 58, 237, 0.05)"
                    : "transparent",
                  transition: "background 0.2s",
                }}
              >
                {isExpanded ? (
                  <ChevronDown
                    size={14}
                    color="#8b949e"
                    style={{ marginRight: "8px", flexShrink: 0 }}
                  />
                ) : (
                  <ChevronRight
                    size={14}
                    color="#8b949e"
                    style={{ marginRight: "8px", flexShrink: 0 }}
                  />
                )}
                <div
                  style={{
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {getStatusIcon(fileStatus, 16)}
                </div>
                <span
                  style={{
                    marginLeft: "8px",
                    fontSize: "13px",
                    fontWeight: isExpanded ? "bold" : "600",
                    color: isExpanded ? "white" : "#c9d1d9",
                    flex: 1,
                    textOverflow: "ellipsis",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                  }}
                >
                  {fileName}
                </span>
              </div>

              {isExpanded && (
                <div style={{ backgroundColor: "#05070a", padding: "5px 0" }}>
                  {blocks.length > 0 ? (
                    blocks.map((block) => {
                      const blockExpanded = expandedBlocks[block.id] !== false;
                      return (
                        <div key={block.id}>
                          <div
                            onClick={(e) => toggleBlock(block.id, e)}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.backgroundColor =
                                "#161b22")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.backgroundColor =
                                "transparent")
                            }
                            style={{
                              display: "flex",
                              alignItems: "center",
                              padding: "8px 15px 8px 35px",
                              cursor: "pointer",
                              borderLeft: "2px solid transparent",
                              transition: "background-color 0.2s",
                            }}
                          >
                            {blockExpanded ? (
                              <ChevronDown
                                size={12}
                                color="#6e7681"
                                style={{ marginRight: "6px", flexShrink: 0 }}
                              />
                            ) : (
                              <ChevronRight
                                size={12}
                                color="#6e7681"
                                style={{ marginRight: "6px", flexShrink: 0 }}
                              />
                            )}
                            <div
                              style={{
                                flexShrink: 0,
                                display: "flex",
                                alignItems: "center",
                              }}
                            >
                              {getStatusIcon(block.status, 12)}
                            </div>
                            <span
                              style={{
                                color: "#a78bfa",
                                fontWeight: "bold",
                                fontSize: "11px",
                                marginLeft: "6px",
                                flexShrink: 0,
                              }}
                            >
                              {block.type}
                            </span>
                            {block.desc && (
                              <span
                                style={{
                                  color: "#c9d1d9",
                                  fontSize: "11px",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  marginLeft: "4px",
                                }}
                              >
                                - "{block.desc}"
                              </span>
                            )}
                          </div>

                          {blockExpanded && (
                            <div style={{ paddingBottom: "8px" }}>
                              {block.steps.map((step) => {
                                const isCurrentTravelTarget =
                                  activeStepId === `${fileName}:::${step.id}` ||
                                  (isRunning &&
                                    activeStepId === step.id &&
                                    activeTestFile === fileName);

                                return (
                                  <div
                                    key={step.id}
                                    onClick={() =>
                                      setActiveStepId(
                                        `${fileName}:::${step.id}`,
                                      )
                                    }
                                    data-active-step={
                                      isCurrentTravelTarget ? "true" : "false"
                                    }
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      padding: "6px 15px 6px 65px",
                                      opacity:
                                        step.status === "pending" ? 0.5 : 1,
                                      cursor: "pointer",
                                      backgroundColor: isCurrentTravelTarget
                                        ? "rgba(124, 58, 237, 0.15)"
                                        : "transparent",
                                      borderLeft: isCurrentTravelTarget
                                        ? "3px solid #a78bfa"
                                        : "3px solid transparent",
                                      transition: "all 0.2s ease",
                                    }}
                                  >
                                    <div
                                      style={{
                                        flexShrink: 0,
                                        display: "flex",
                                        alignItems: "center",
                                      }}
                                    >
                                      {getStatusIcon(step.status, 10)}
                                    </div>
                                    <span
                                      style={{
                                        color: isCurrentTravelTarget
                                          ? "#fff"
                                          : "#8b949e",
                                        fontWeight: isCurrentTravelTarget
                                          ? "bold"
                                          : "normal",
                                        fontFamily: "monospace",
                                        fontSize: "11px",
                                        flex: 1,
                                        textOverflow: "ellipsis",
                                        overflow: "hidden",
                                        whiteSpace: "nowrap",
                                        marginLeft: "8px",
                                      }}
                                    >
                                      {step.command}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div
                      style={{
                        padding: "20px",
                        textAlign: "center",
                        color: "#8b949e",
                        fontSize: "11px",
                      }}
                    >
                      Awaiting execution...
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

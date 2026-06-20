import { useState, useEffect, useRef } from "react";
import { Search, Play, Film, Copy, Check } from "lucide-react";
import { useFlowStore, type LogType, type LogEvent } from "../store";
import { sendToRunner } from "../socket";

const JsonNode = ({
  label,
  value,
  isRoot = false,
}: {
  label: string | null;
  value: any;
  isRoot?: boolean;
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  if (value === null || typeof value !== "object") {
    let valColor = "#79c0ff";
    if (typeof value === "string") valColor = "#a5d6ff";
    if (typeof value === "boolean" || value === null) valColor = "#ff7b72";
    return (
      <div
        style={{
          paddingLeft: isRoot ? "0" : "16px",
          fontFamily: "monospace",
          fontSize: "12px",
        }}
      >
        {label && (
          <span style={{ color: "#d2a8ff", marginRight: "6px" }}>{label}:</span>
        )}
        <span style={{ color: valColor }}>
          {value === null
            ? "null"
            : typeof value === "string"
              ? `"${value}"`
              : String(value)}
        </span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const keys = Object.keys(value || {});
  const isEmpty = keys.length === 0;

  return (
    <div
      style={{
        paddingLeft: isRoot ? "0" : "16px",
        fontFamily: "monospace",
        fontSize: "12px",
      }}
    >
      <div
        onClick={() => !isEmpty && setIsExpanded(!isExpanded)}
        style={{
          cursor: isEmpty ? "default" : "display",
          display: "flex",
          alignItems: "center",
        }}
      >
        <span style={{ width: "14px", color: "#8b949e", cursor: "pointer" }}>
          {!isEmpty && (isExpanded ? "▼" : "▶")}
        </span>
        {label && (
          <span style={{ color: "#d2a8ff", marginRight: "6px" }}>{label}:</span>
        )}
        <span style={{ color: "#8b949e" }}>
          {isArray ? (isExpanded ? "[" : "[...]") : isExpanded ? "{" : "{...}"}
        </span>
      </div>
      {isExpanded && !isEmpty && (
        <div
          style={{
            paddingLeft: "8px",
            borderLeft: "1px solid #30363d",
            marginLeft: "6px",
          }}
        >
          {keys.map((key) => (
            <JsonNode
              key={key}
              label={isArray ? null : key}
              value={value[key]}
            />
          ))}
        </div>
      )}
      {isExpanded && !isEmpty && (
        <div style={{ color: "#8b949e" }}>{isArray ? "]" : "}"}</div>
      )}
    </div>
  );
};

const getLogDisplayData = (log: LogEvent) => {
  let name = log.summary;
  let methodLabel = "-";
  let typeLabel = log.type.toLowerCase();
  let statusLabel = log.status === "error" ? "ERR" : "OK";
  let statusColor = log.status === "error" ? "#f87171" : "#8b949e";

  if (log.type === "REST" || log.type === "GRAPHQL") {
    typeLabel = "fetch";
    methodLabel = log.details?.method || "GET";
    if (log.details?.url) {
      try {
        const urlObj = new URL(log.details.url);
        name = urlObj.pathname.split("/").pop() || urlObj.pathname;
        if (!name || name === "/") name = urlObj.hostname;
      } catch {
        const parts = log.details.url.split("/");
        name = parts[parts.length - 1] || log.summary;
      }
    }
    statusLabel =
      log.details?.responseStatus?.toString() ||
      (log.status === "error" ? "ERR" : "200");
    statusColor = log.status === "error" ? "#f87171" : "#34d399";
  } else if (log.type === "ACTION") {
    name = log.details?.command || log.summary.split(":")[0];
    typeLabel = "action";
    statusColor = log.status === "error" ? "#f87171" : "#60a5fa";
  } else if (log.type === "ASSERT") {
    typeLabel = "assert";
    statusColor = log.status === "error" ? "#f87171" : "#a78bfa";
  } else if (log.type === "ERROR") {
    statusColor = "#f87171";

    const msg = log.summary || "";
    if (msg.includes("waited for")) name = "Element Not Found";
    else if (msg.includes("covering it up")) name = "Element Blocked";
    else if (msg.includes("multiple elements matching"))
      name = "Multiple Elements";
    else if (msg.includes("couldn't reach")) name = "Network Error";
    else name = "Execution Failed";
  } else if (log.type === "CONSOLE") {
    typeLabel = "console";
  }

  let methodColor = "#8b949e";
  if (methodLabel === "GET") methodColor = "#60a5fa";
  if (methodLabel === "POST") methodColor = "#34d399";
  if (methodLabel === "PUT" || methodLabel === "PATCH") methodColor = "#fbbf24";
  if (methodLabel === "DELETE") methodColor = "#f87171";

  return {
    name,
    methodLabel,
    methodColor,
    typeLabel,
    statusLabel,
    statusColor,
  };
};

export const LogsView = () => {
  const { logs, selectedLogId, setSelectedLogId, activeReplay, updateReplay } =
    useFlowStore();
  const [activeFilter, setActiveFilter] = useState<"ALL" | LogType>("ALL");
  const [activeTab, setActiveTab] = useState("Overview");
  const [activeVideoFile, setActiveVideoFile] = useState<string | null>(null);

  const [isCopied, setIsCopied] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState(380);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      const containerLeft = containerRef.current.getBoundingClientRect().left;
      const newWidth = e.clientX - containerLeft;

      if (newWidth >= 250 && newWidth <= 800) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (selectedLogId && (!logs || !logs.find((l) => l.id === selectedLogId))) {
      setSelectedLogId(null);
    }
  }, [logs, selectedLogId, setSelectedLogId]);

  const safeLogs = Array.isArray(logs) ? logs : [];
  const selectedLog = safeLogs.find((log) => log.id === selectedLogId);

  interface LogSection {
    fileName: string;
    items: LogEvent[];
  }

  const sectionsMap: Record<string, LogEvent[]> = {};
  const orderedFileNames: string[] = [];

  safeLogs.forEach((log) => {
    if (!log) return;

    if (log.type === "FILE_HEADER") {
      if (!orderedFileNames.includes(log.summary)) {
        orderedFileNames.push(log.summary);
      }
      return;
    }

    const targetFile = (log as any).fileName || "System Initialization";

    if (!sectionsMap[targetFile]) {
      sectionsMap[targetFile] = [];
      if (!orderedFileNames.includes(targetFile)) {
        orderedFileNames.push(targetFile);
      }
    }

    if (activeFilter === "ALL" || log.type === activeFilter) {
      sectionsMap[targetFile].push(log);
    }
  });

  const logSections: LogSection[] = orderedFileNames
    .map((name) => ({
      fileName: name,
      items: sectionsMap[name] || [],
    }))
    .filter((section) => section.items.length > 0);

  const isNetwork =
    selectedLog?.type === "REST" || selectedLog?.type === "GRAPHQL";

  const tabs = ["Overview", "Headers", "Payload"];
  if (isNetwork && selectedLog?.details?.curlString) {
    tabs.push("cURL");
  }
  tabs.push("Response", "Step Context");
  if (isNetwork) tabs.push("Replay");

  const handleSendReplay = () => {
    if (!activeReplay) return;
    updateReplay("isLoading", true);
    updateReplay("response", null);
    updateReplay("status", null);

    sendToRunner("REPLAY_REQ", {
      method: activeReplay.method,
      url: activeReplay.url,
      headers: activeReplay.headers,
      body: activeReplay.body,
    });
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  const renderTabContent = () => {
    if (!selectedLog) return null;
    const details = selectedLog.details || {};

    switch (activeTab) {
      case "Overview":
        return (
          <div
            style={{
              padding: "15px",
              backgroundColor: "#161b22",
              borderRadius: "8px",
              border: "1px solid #30363d",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                fontSize: "13px",
              }}
            >
              <div
                style={{
                  paddingBottom: "12px",
                  marginBottom: "4px",
                  borderBottom: "1px solid #30363d",
                }}
              >
                <span
                  style={{
                    color:
                      selectedLog.status === "error" ? "#f87171" : "#a78bfa",
                    fontWeight: "bold",
                    display: "block",
                    marginBottom: "6px",
                  }}
                >
                  {selectedLog.status === "error"
                    ? "Error Message:"
                    : "Summary:"}
                </span>
                <span
                  style={{
                    color: "#c9d1d9",
                    lineHeight: "1.6",
                    fontSize: "14px",
                  }}
                >
                  {selectedLog.summary}
                </span>
              </div>

              <div>
                <span
                  style={{
                    color: "#8b949e",
                    width: "80px",
                    display: "inline-block",
                  }}
                >
                  Context:
                </span>{" "}
                {selectedLog.stepContext || "System"}
              </div>
              <div>
                <span
                  style={{
                    color: "#8b949e",
                    width: "80px",
                    display: "inline-block",
                  }}
                >
                  URL:
                </span>{" "}
                {details.url || "N/A"}
              </div>
              <div>
                <span
                  style={{
                    color: "#8b949e",
                    width: "80px",
                    display: "inline-block",
                  }}
                >
                  Status:
                </span>{" "}
                <span
                  style={{
                    color:
                      selectedLog.status === "error" ? "#f87171" : "#34d399",
                    fontWeight: "bold",
                  }}
                >
                  {details.responseStatus || selectedLog.status.toUpperCase()}
                </span>
              </div>
            </div>
          </div>
        );
      case "Headers":
        return (
          <JsonNode
            label="Headers"
            value={{
              request: details.requestHeaders || {},
              response: details.responseHeaders || {},
            }}
            isRoot
          />
        );
      case "Payload":
        return (
          <JsonNode
            label="Payload"
            value={details.requestBody || details}
            isRoot
          />
        );
      case "cURL":
        return (
          <div style={{ position: "relative" }}>
            <button
              onClick={() => copyToClipboard(details.curlString)}
              style={{
                position: "absolute",
                top: "10px",
                right: "10px",
                background: "rgba(124, 58, 237, 0.1)",
                border: "1px solid rgba(124, 58, 237, 0.3)",
                color: "#a78bfa",
                padding: "6px 12px",
                borderRadius: "4px",
                fontSize: "11px",
                fontWeight: "bold",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
                transition: "all 0.2s",
                zIndex: 10,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(124, 58, 237, 0.2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(124, 58, 237, 0.1)";
              }}
            >
              {isCopied ? (
                <>
                  <Check size={12} /> Copied!
                </>
              ) : (
                <>
                  <Copy size={12} /> Copy
                </>
              )}
            </button>
            <pre
              style={{
                background: "#05070a",
                padding: "20px 15px",
                paddingRight: "90px", // Prevent text overlapping the button
                borderRadius: "8px",
                border: "1px solid #30363d",
                color: "#a5d6ff",
                fontFamily: "monospace",
                fontSize: "12px",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                overflowX: "auto",
                lineHeight: "1.5",
              }}
            >
              <code>{details.curlString}</code>
            </pre>
          </div>
        );
      case "Response":
        return (
          <JsonNode
            label="Response"
            value={details.responseBody || { message: "No body captured" }}
            isRoot
          />
        );
      case "Step Context":
        return (
          <div
            style={{
              padding: "15px",
              borderLeft: "4px solid #a78bfa",
              backgroundColor: "rgba(167, 139, 250, 0.05)",
            }}
          >
            {selectedLog.stepContext}
          </div>
        );

      case "Replay":
        if (!activeReplay) return null;
        const inputStyle = {
          background: "#05070a",
          border: "1px solid #30363d",
          color: "white",
          padding: "8px",
          borderRadius: "4px",
          fontSize: "12px",
          fontFamily: "monospace",
        };

        return (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "15px" }}
          >
            <div style={{ display: "flex", gap: "10px" }}>
              <input
                value={activeReplay.method}
                onChange={(e) =>
                  updateReplay("method", e.target.value.toUpperCase())
                }
                style={{
                  ...inputStyle,
                  width: "80px",
                  fontWeight: "bold",
                  color: "#a78bfa",
                }}
                placeholder="GET"
              />
              <input
                value={activeReplay.url}
                onChange={(e) => updateReplay("url", e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
                placeholder="https://api..."
              />
              <button
                onClick={handleSendReplay}
                disabled={activeReplay.isLoading}
                style={{
                  background: activeReplay.isLoading ? "#30363d" : "#7c3aed",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  padding: "0 20px",
                  cursor: activeReplay.isLoading ? "wait" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  fontWeight: "bold",
                }}
              >
                {activeReplay.isLoading ? (
                  "Sending..."
                ) : (
                  <>
                    <Play size={14} fill="currentColor" /> Send
                  </>
                )}
              </button>
            </div>

            <div style={{ display: "flex", gap: "15px" }}>
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: "5px",
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    color: "#8b949e",
                    fontWeight: "bold",
                  }}
                >
                  HEADERS (JSON)
                </span>
                <textarea
                  value={activeReplay.headers}
                  onChange={(e) => updateReplay("headers", e.target.value)}
                  style={{ ...inputStyle, height: "120px", resize: "vertical" }}
                />
              </div>
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: "5px",
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    color: "#8b949e",
                    fontWeight: "bold",
                  }}
                >
                  BODY (JSON)
                </span>
                <textarea
                  value={activeReplay.body}
                  onChange={(e) => updateReplay("body", e.target.value)}
                  style={{ ...inputStyle, height: "120px", resize: "vertical" }}
                />
              </div>
            </div>

            {activeReplay.status && (
              <div
                style={{
                  marginTop: "10px",
                  paddingTop: "15px",
                  borderTop: "1px solid #30363d",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    marginBottom: "15px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      color: "#8b949e",
                      fontWeight: "bold",
                    }}
                  >
                    LIVE RESPONSE:
                  </span>
                  <span
                    style={{
                      backgroundColor:
                        activeReplay.status < 400
                          ? "rgba(52, 211, 153, 0.1)"
                          : "rgba(248, 113, 113, 0.1)",
                      color: activeReplay.status < 400 ? "#34d399" : "#f87171",
                      border: `1px solid ${activeReplay.status < 400 ? "rgba(52, 211, 153, 0.2)" : "rgba(248, 113, 113, 0.2)"}`,
                      fontSize: "10px",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontWeight: "bold",
                    }}
                  >
                    {activeReplay.status}
                  </span>
                </div>
                <div
                  style={{
                    padding: "15px",
                    backgroundColor: "#05070a",
                    borderRadius: "4px",
                    border: "1px solid #30363d",
                  }}
                >
                  <JsonNode label={null} value={activeReplay.response} isRoot />
                </div>
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        backgroundColor: "#0d1117",
        color: "#c9d1d9",
        overflow: "hidden",
        userSelect: isDragging ? "none" : "auto",
      }}
    >
      {/* LEFT SIDEBAR */}
      <div
        style={{
          width: sidebarWidth,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "15px 15px 10px 15px" }}>
          <div
            style={{
              display: "flex",
              gap: "5px",
              overflowX: "auto",
              paddingBottom: "5px",
              scrollbarWidth: "none",
            }}
          >
            {["ALL", "REST", "ACTION", "ASSERT", "ERROR"].map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f as any)}
                style={{
                  background:
                    activeFilter === f
                      ? "rgba(124, 58, 237, 0.1)"
                      : "transparent",
                  border: "1px solid #30363d",
                  color: activeFilter === f ? "#a78bfa" : "#8b949e",
                  padding: "3px 8px",
                  borderRadius: "4px",
                  fontSize: "10px",
                  cursor: "pointer",
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            padding: "6px 15px",
            borderTop: "1px solid #30363d",
            borderBottom: "1px solid #30363d",
            fontSize: "10px",
            fontWeight: "bold",
            color: "#8b949e",
            backgroundColor: "#161b22",
          }}
        >
          <div style={{ flex: "1 1 auto", paddingRight: "8px" }}>Name</div>
          <div style={{ width: "45px", flexShrink: 0 }}>Method</div>
          <div style={{ width: "45px", flexShrink: 0 }}>Status</div>
          <div style={{ width: "45px", flexShrink: 0 }}>Type</div>
          <div style={{ width: "65px", flexShrink: 0, textAlign: "right" }}>
            Time
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {logSections.map((section, sIdx) => {
            const hasError = section.items.some(
              (log) => log.status === "error",
            );
            const errorCount = section.items.filter(
              (log) => log.status === "error",
            ).length;

            return (
              <div key={section.fileName + sIdx}>
                {/* SECTION HEADING BANNER */}
                <div
                  style={{
                    padding: "6px 15px",
                    backgroundColor: hasError
                      ? "rgba(248, 113, 113, 0.1)"
                      : "#161b22",
                    borderBottom: hasError
                      ? "1px solid rgba(248, 113, 113, 0.3)"
                      : "1px solid #30363d",
                    fontSize: "11px",
                    fontWeight: "bold",
                    color: hasError ? "#f87171" : "#a78bfa",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span style={{ opacity: 0.7 }}>📄</span>
                    <span>{section.fileName}</span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveVideoFile(section.fileName);
                        setSelectedLogId(null);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        backgroundColor: "rgba(52, 211, 153, 0.1)",
                        color: "#34d399",
                        border: "1px solid rgba(52, 211, 153, 0.3)",
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontSize: "9px",
                        fontWeight: "bold",
                        cursor: "pointer",
                        transition: "background 0.2s",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          "rgba(52, 211, 153, 0.2)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor =
                          "rgba(52, 211, 153, 0.1)")
                      }
                    >
                      <Film size={10} /> Watch
                    </button>

                    {hasError && (
                      <span
                        style={{
                          backgroundColor: "#f87171",
                          color: "white",
                          padding: "2px 6px",
                          borderRadius: "10px",
                          fontSize: "9px",
                          fontWeight: "900",
                        }}
                      >
                        {errorCount} ERROR{errorCount > 1 ? "S" : ""}
                      </span>
                    )}
                  </div>
                </div>

                {section.items.map((log) => {
                  const {
                    name,
                    methodLabel,
                    methodColor,
                    typeLabel,
                    statusLabel,
                    statusColor,
                  } = getLogDisplayData(log);
                  return (
                    <div
                      key={log.id}
                      onClick={() => {
                        setSelectedLogId(log.id);
                        setActiveVideoFile(null);
                        setActiveTab("Overview");
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "8px 15px 8px 25px",
                        cursor: "pointer",
                        backgroundColor:
                          selectedLogId === log.id
                            ? "rgba(124, 58, 237, 0.15)"
                            : "transparent",
                        borderBottom: "1px solid #21262d",
                        fontSize: "11px",
                        transition: "background 0.1s",
                      }}
                    >
                      <div
                        style={{
                          flex: "1 1 auto",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          paddingRight: "8px",
                          color: "#c9d1d9",
                          fontWeight: selectedLogId === log.id ? "bold" : "500",
                        }}
                      >
                        {name}
                      </div>
                      <div
                        style={{
                          width: "45px",
                          flexShrink: 0,
                          color: methodColor,
                          fontWeight: "bold",
                        }}
                      >
                        {methodLabel}
                      </div>
                      <div
                        style={{
                          width: "45px",
                          flexShrink: 0,
                          color: statusColor,
                          fontWeight: "bold",
                        }}
                      >
                        {statusLabel}
                      </div>
                      <div
                        style={{
                          width: "45px",
                          flexShrink: 0,
                          color: "#8b949e",
                        }}
                      >
                        {typeLabel}
                      </div>
                      <div
                        style={{
                          width: "65px",
                          flexShrink: 0,
                          textAlign: "right",
                          color: "#6e7681",
                          fontFamily: "monospace",
                        }}
                      >
                        {log.timestamp}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}

          {logSections.length === 0 && (
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
      </div>

      <div
        onMouseDown={() => setIsDragging(true)}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "#7c3aed";
        }}
        onMouseLeave={(e) => {
          if (!isDragging)
            e.currentTarget.style.backgroundColor = "transparent";
        }}
        style={{
          width: "5px",
          cursor: "col-resize",
          backgroundColor: isDragging ? "#7c3aed" : "transparent",
          borderRight: isDragging ? "none" : "1px solid #30363d",
          zIndex: 10,
          transition: "background-color 0.2s ease",
        }}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          backgroundColor: activeVideoFile ? "#000" : "#0d1117",
        }}
      >
        {activeVideoFile ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div
              style={{
                padding: "12px 15px",
                borderBottom: "1px solid #30363d",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <Film size={14} color="#34d399" />
                <span
                  style={{
                    color: "white",
                    fontWeight: "bold",
                    fontSize: "12px",
                  }}
                >
                  Session Replay: {activeVideoFile}
                </span>
              </div>
              <button
                onClick={() => setActiveVideoFile(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#8b949e",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                ✕ Close
              </button>
            </div>
            <div
              style={{
                flex: 1,
                padding: "20px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundImage:
                  "radial-gradient(circle at center, #161b22 0%, #000 100%)",
              }}
            >
              <video
                key={activeVideoFile}
                src={`http://${window.location.host}/videos/${activeVideoFile.replace(".flow", "")}.webm`}
                controls
                autoPlay
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                  borderRadius: "8px",
                  border: "1px solid #30363d",
                }}
              />
            </div>
          </div>
        ) : selectedLog ? (
          <>
            <div
              style={{
                display: "flex",
                borderBottom: "1px solid #30363d",
                backgroundColor: "#0d1117",
              }}
            >
              {tabs.map((tab) => (
                <div
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    padding: "12px 15px",
                    fontSize: "11px",
                    cursor: "pointer",
                    color: activeTab === tab ? "#a78bfa" : "#8b949e",
                    borderBottom:
                      activeTab === tab ? "2px solid #a78bfa" : "none",
                    fontWeight: tab === "Replay" ? "bold" : "normal",
                  }}
                >
                  {tab === "Replay" ? "▶ Replay" : tab}
                </div>
              ))}
            </div>

            <div style={{ flex: 1, padding: "20px", overflow: "auto" }}>
              <div style={{ minWidth: "fit-content" }}>
                {renderTabContent()}
              </div>
            </div>
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              opacity: 0.2,
            }}
          >
            <Search size={48} />
            <p style={{ marginTop: "10px" }}>Select a log to inspect</p>
          </div>
        )}
      </div>
    </div>
  );
};

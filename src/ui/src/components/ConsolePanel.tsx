import { useEffect, useRef } from "react";
import { useFlowStore } from "../store";

export const ConsolePanel = () => {
  const { logs } = useFlowStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div
      ref={scrollRef}
      style={{
        flex: 1,
        backgroundColor: "#0d1117",
        padding: "10px 15px",
        fontFamily: "monospace",
        fontSize: "12px",
        overflowY: "auto",
        color: "#d1d5db",
        lineHeight: "1.5",
      }}
    >
      {logs.length === 0 && (
        <div style={{ color: "#4b5563", fontStyle: "italic" }}>
          System ready. Awaiting execution...
        </div>
      )}

      {logs.map((log, index) => {
        const label = (log.type || log.status || "INFO").toUpperCase();

        let color = "#34d399"; // default green
        if (log.status === "error" || log.type === "ERROR") color = "#f87171";
        if (log.status === "warning") color = "#fbbf24";
        if (log.type === "ACTION") color = "#60a5fa";

        return (
          <div
            key={log.id || index}
            style={{ marginBottom: "4px", display: "flex", gap: "8px" }}
          >
            <span style={{ color: "#6e7681", flexShrink: 0 }}>
              [{log.timestamp || "--:--:--"}]
            </span>
            <span
              style={{
                color,
                fontWeight: "bold",
                flexShrink: 0,
                width: "55px",
              }}
            >
              {label}
            </span>
            <span style={{ color: "#c9d1d9", wordBreak: "break-all" }}>
              {log.summary}
            </span>
          </div>
        );
      })}
    </div>
  );
};

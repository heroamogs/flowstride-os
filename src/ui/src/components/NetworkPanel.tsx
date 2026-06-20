import { Search, Filter } from "lucide-react";
import { useFlowStore } from "../store";

export const NetworkPanel = () => {
  const {
    networkLogs,
    activeNetworkTab,
    setNetworkTab,
    setSelectedLogId,
    setActiveView,
  } = useFlowStore();

  const tabs: Array<"REST" | "GraphQL" | "Network" | "WS"> = [
    "REST",
    "GraphQL",
    "Network",
    "WS",
  ];

  const filteredLogs = networkLogs.filter((log) => {
    if (activeNetworkTab === "GraphQL") return log.url.includes("graphql");
    if (activeNetworkTab === "REST")
      return !log.url.includes("graphql") && !log.url.includes("ws");
    return true;
  });

  const handleRequestClick = (logId: string) => {
    setSelectedLogId(logId);
    setActiveView("Logs");
  };

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#0d1117",
      }}
    >
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--fs-border)",
          backgroundColor: "#05070a",
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setNetworkTab(tab)}
            style={{
              padding: "10px 16px",
              fontSize: "11px",
              fontWeight: "600",
              background: "none",
              border: "none",
              color: activeNetworkTab === tab ? "#a78bfa" : "#444",
              borderBottom:
                activeNetworkTab === tab
                  ? "2px solid #7c3aed"
                  : "2px solid transparent",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      <div
        style={{
          padding: "8px 12px",
          display: "flex",
          gap: "10px",
          alignItems: "center",
          borderBottom: "1px solid #161b22",
        }}
      >
        <div style={{ flex: 1, position: "relative" }}>
          <Search
            size={12}
            style={{
              position: "absolute",
              left: "8px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "#444",
            }}
          />
          <input
            type="text"
            placeholder={`Filter ${activeNetworkTab}...`}
            style={{
              width: "100%",
              background: "#05070a",
              border: "1px solid #30363d",
              borderRadius: "4px",
              padding: "4px 8px 4px 28px",
              fontSize: "10px",
              color: "white",
            }}
          />
        </div>
        <Filter size={14} color="#444" />
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {filteredLogs.length === 0 ? (
          <div
            style={{
              padding: "40px",
              textAlign: "center",
              color: "#444",
              fontSize: "11px",
            }}
          >
            No {activeNetworkTab} traffic detected
          </div>
        ) : (
          filteredLogs.map((log, i) => (
            <div
              key={i}
              onClick={() => handleRequestClick(log.id)}
              style={{
                borderBottom: "1px solid #161b22",
                cursor: "pointer",
                transition: "background 0.2s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "#161b22")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "8px 12px",
                  fontSize: "11px",
                  gap: "10px",
                }}
              >
                <span
                  style={{
                    color: log.status < 400 ? "#34d399" : "#f87171",
                    fontWeight: "bold",
                    width: "25px",
                  }}
                >
                  {log.status}
                </span>
                <span
                  style={{
                    fontWeight: "bold",
                    width: "35px",
                    color: "#8b949e",
                  }}
                >
                  {log.method}
                </span>
                <span
                  style={{
                    flex: 1,
                    color: "white",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {log.name || log.url}
                </span>
                <span style={{ color: "#444", fontSize: "10px" }}>
                  {log.time}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useFlowStore } from "../store"; // STRICT MICRO STEP: Import the store

// Strictly define the upgraded shape of our run metadata expected from the backend
export interface RunMeta {
  id: string;
  name: string;
  metrics?: {
    status: string;
    passed: number;
    failed: number;
    total: number;
  };
}

export const RunsView = () => {
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // STRICT MICRO STEP: Extract the routing bridge from Zustand
  const { setActiveView, setActiveHistoricalRunId } = useFlowStore();

  useEffect(() => {
    const fetchRuns = async () => {
      try {
        const response = await fetch("/api/runs");
        if (response.ok) {
          const data = await response.json();
          // Mathematically sort runs chronologically (newest first) based on the ID string
          const sortedRuns = (data.runs || []).sort((a: RunMeta, b: RunMeta) =>
            b.id.localeCompare(a.id),
          );
          setRuns(sortedRuns);
        } else {
          toast.error("Failed to fetch runs from local vault.");
        }
      } catch (error) {
        console.error("[Flowstride Telemetry Error]:", error);
        toast.error("Failed to connect to local backend.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchRuns();
  }, []);

  // Securely filter runs based on the user's search query
  const filteredRuns = runs.filter(
    (run) =>
      run.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      run.id.includes(searchQuery),
  );

  // Helper functions for strict enterprise UI styling
  const getStatusColor = (status: string) => {
    if (status === "PASS") return "#3fb950"; // Success Green
    if (status === "FAIL") return "#f85149"; // Error Red
    return "#d2a8ff"; // Warning/Unknown Purple
  };

  const getStatusBg = (status: string) => {
    if (status === "PASS") return "rgba(46, 160, 67, 0.15)";
    if (status === "FAIL") return "rgba(248, 81, 73, 0.15)";
    return "rgba(210, 168, 255, 0.15)";
  };

  return (
    <div
      style={{
        flex: 1,
        backgroundColor: "#0b0e14",
        color: "#c9d1d9",
        padding: "32px",
        overflowY: "auto",
      }}
    >
      {/* Top Header & Search Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
        }}
      >
        <h2
          style={{
            color: "#ffffff",
            margin: 0,
            fontSize: "24px",
            fontWeight: "600",
          }}
        >
          Test Execution Runs
        </h2>

        <div style={{ display: "flex", gap: "12px" }}>
          <input
            type="text"
            placeholder="Search runs by name or date..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              backgroundColor: "#0d1117",
              border: "1px solid #30363d",
              borderRadius: "6px",
              padding: "8px 12px",
              color: "#c9d1d9",
              fontSize: "13px",
              width: "280px",
              outline: "none",
              transition: "border-color 0.2s",
            }}
            onFocus={(e) => (e.target.style.borderColor = "#58a6ff")}
            onBlur={(e) => (e.target.style.borderColor = "#30363d")}
          />
        </div>
      </div>

      {/* Data Grid Table */}
      {isLoading ? (
        <div
          style={{ display: "flex", justifyContent: "center", padding: "40px" }}
        >
          <p style={{ color: "#8b949e", fontSize: "14px" }}>
            Securely accessing local vault...
          </p>
        </div>
      ) : runs.length === 0 ? (
        <div
          style={{
            padding: "40px",
            textAlign: "center",
            border: "1px dashed #30363d",
            borderRadius: "8px",
          }}
        >
          <p style={{ color: "#8b949e" }}>
            No execution runs found in the vault.
          </p>
        </div>
      ) : (
        <div
          style={{
            border: "1px solid #30363d",
            borderRadius: "8px",
            overflow: "hidden",
            backgroundColor: "#0d1117",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              textAlign: "left",
              fontSize: "13px",
            }}
          >
            <thead
              style={{
                backgroundColor: "#161b22",
                borderBottom: "1px solid #30363d",
              }}
            >
              <tr>
                <th
                  style={{
                    padding: "12px 16px",
                    color: "#8b949e",
                    fontWeight: "600",
                    width: "15%",
                  }}
                >
                  DATE
                </th>
                <th
                  style={{
                    padding: "12px 16px",
                    color: "#8b949e",
                    fontWeight: "600",
                    width: "15%",
                  }}
                >
                  TIME
                </th>
                <th
                  style={{
                    padding: "12px 16px",
                    color: "#8b949e",
                    fontWeight: "600",
                    width: "40%",
                  }}
                >
                  RUN NAME
                </th>
                <th
                  style={{
                    padding: "12px 16px",
                    color: "#8b949e",
                    fontWeight: "600",
                    width: "10%",
                  }}
                >
                  STATUS
                </th>
                <th
                  style={{
                    padding: "12px 16px",
                    color: "#8b949e",
                    fontWeight: "600",
                    width: "20%",
                  }}
                >
                  METRICS
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((run) => {
                // Mathematically extract date and time from the directory structure (YYYY-MM-DD/HH-MM-SS/filename.json)
                const pathParts = run.id.split("/");
                const datePart = pathParts.length >= 3 ? pathParts[0] : "N/A";
                const timePart =
                  pathParts.length >= 3
                    ? pathParts[1].replace(/-/g, ":")
                    : "N/A";

                // Securely unpack metrics with fallbacks
                const status = run.metrics?.status || "UNKNOWN";
                const passed = run.metrics?.passed || 0;
                const failed = run.metrics?.failed || 0;
                const total = run.metrics?.total || 0;

                return (
                  <tr
                    key={run.id}
                    style={{
                      borderBottom: "1px solid #21262d",
                      transition: "background-color 0.2s",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = "#1c2128")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "transparent")
                    }
                    onClick={() => {
                      // STRICT MICRO STEP: Wire the routing payload
                      setActiveHistoricalRunId(run.id);
                      setActiveView("Workspace");
                    }}
                  >
                    <td style={{ padding: "12px 16px", color: "#c9d1d9" }}>
                      {datePart}
                    </td>
                    <td style={{ padding: "12px 16px", color: "#8b949e" }}>
                      {timePart}
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        color: "#58a6ff",
                        fontWeight: "500",
                      }}
                    >
                      {run.name}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        style={{
                          color: getStatusColor(status),
                          backgroundColor: getStatusBg(status),
                          padding: "4px 8px",
                          borderRadius: "12px",
                          fontSize: "11px",
                          fontWeight: "600",
                          display: "inline-block",
                        }}
                      >
                        {status}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "12px 16px",
                        color: "#8b949e",
                        fontSize: "12px",
                      }}
                    >
                      {total === 0 ? (
                        "No steps recorded"
                      ) : (
                        <>
                          <span
                            style={{
                              color: passed > 0 ? "#3fb950" : "#8b949e",
                              fontWeight: passed > 0 ? "500" : "normal",
                            }}
                          >
                            {passed} Passed
                          </span>
                          <span style={{ margin: "0 4px" }}>•</span>
                          <span
                            style={{
                              color: failed > 0 ? "#f85149" : "#8b949e",
                              fontWeight: failed > 0 ? "500" : "normal",
                            }}
                          >
                            {failed} Failed
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filteredRuns.length === 0 && (
            <div
              style={{ padding: "32px", textAlign: "center", color: "#8b949e" }}
            >
              No runs match your search query.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

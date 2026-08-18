import { useState, useRef, useEffect } from "react";
import { WorkspaceMode } from "workspace_engine";
import {
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Plus,
  Pencil,
  Download,
  Loader2,
  Trash2,
  Check,
  ZoomOut,
  ZoomIn,
} from "lucide-react";

export interface FlowTemplateMeta {
  id: string;
  name: string;
}

export interface FlowMetadata {
  flowName?: string;
  version: string;
  testPlan: string;
  environment: string;
  lastUpdatedBy: string;
  lastUpdatedAt?: number;
  testedBy?: string;
}

interface TopToolbarProps {
  activeMode: WorkspaceMode;
  onModeChange: (mode: WorkspaceMode) => void;
  onSave?: (explicitFilename?: string) => Promise<void>;

  flows?: FlowTemplateMeta[];
  activeFlowId?: string;
  onSelectFlow?: (id: string) => void;
  onCreateFlow?: () => void;
  onDeleteFlow?: (id: string) => void;
  onRenameFlow?: (id: string, newName: string) => void;

  zoomLevel?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;

  metadata?: FlowMetadata;
  onMetadataChange?: (meta: FlowMetadata) => void;
}

export const TopToolbar = ({
  activeMode,
  onModeChange,
  onSave,
  flows = [],
  activeFlowId,
  onSelectFlow,
  onCreateFlow,
  onDeleteFlow,
  onRenameFlow,
  zoomLevel = 1.0,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  metadata,
  onMetadataChange,
}: TopToolbarProps) => {
  const [isSaving, setIsSaving] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");

  const dropdownRef = useRef<HTMLDivElement>(null);
  const isSubmittingRef = useRef(false);

  // STRICT MICRO STEP: The open source version only relies on the execution state soft lock
  const isMetadataLocked = activeMode === WorkspaceMode.Execution;

  const activeFlow = flows.find((f) => f.id === activeFlowId);
  const activeFlowName = activeFlow ? activeFlow.name : "New Local Flow";

  const getRelativeTime = (timestamp?: number) => {
    if (!timestamp) return "Just now";
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };
    if (isDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isDropdownOpen]);

  // STRICT MICRO STEP: Secure offline Blob file generation
  const handleSaveClick = async () => {
    setIsSaving(true);
    try {
      const engineAPI = (window as any).flowstrideEngineAPI;
      if (engineAPI) {
        // Extract the pristine memory layout from the Wasm engine
        const designState = engineAPI.exportDesignState();

        // Mathematically merge it with the React UI metadata
        const exportData = {
          metadata: {
            flowName: activeFlowName,
            version: metadata?.version || "1.0",
            testPlan: metadata?.testPlan || "",
            environment: metadata?.environment || "Local",
            lastUpdatedBy: metadata?.lastUpdatedBy || "Local User",
            lastUpdatedAt: Date.now(),
          },
          canvas: designState,
        };

        // Construct the offline file download
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        const safeFilename = activeFlowName
          .replace(/[^a-z0-9]/gi, "_")
          .toLowerCase();
        a.download = `${safeFilename || "local_workspace"}.json`;
        document.body.appendChild(a);
        a.click();

        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      // We strictly call onSave if the parent needs to update local UI timestamps
      if (onSave) {
        await onSave();
      }
    } catch (error) {
      console.error(
        "[Flowstride Telemetry Error]: Failed to generate local export file",
        error,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();

    const confirmed = window.confirm(
      `Are you sure you want to delete the flow: "${name}"?`,
    );
    if (confirmed && onDeleteFlow) {
      onDeleteFlow(id);
    }
  };

  const startEditing = () => {
    if (isMetadataLocked) return;
    setEditTitleValue(activeFlowName);
    setIsEditingTitle(true);
  };

  const submitTitleEdit = async () => {
    if (isSubmittingRef.current || isMetadataLocked) return;
    isSubmittingRef.current = true;

    const newName = editTitleValue.trim();
    setIsEditingTitle(false);

    if (newName !== "" && activeFlowId && onRenameFlow) {
      onRenameFlow(activeFlowId, newName);

      if (onSave) {
        setIsSaving(true);
        try {
          await onSave(newName);
        } finally {
          setIsSaving(false);
        }
      }
    }

    isSubmittingRef.current = false;
  };

  return (
    <div
      style={{
        padding: "16px 24px",
        borderBottom: "1px solid #e1e4e8",
        backgroundColor: "#ffffff",
        flexShrink: 0,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          flex: 1,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            fontSize: "13px",
            color: "#57606a",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span>Local Workspaces</span>
            <ChevronRight size={14} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div ref={dropdownRef} style={{ position: "relative" }}>
              <button
                onClick={() => {
                  if (!isMetadataLocked) setIsDropdownOpen(!isDropdownOpen);
                }}
                disabled={isMetadataLocked}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 12px",
                  border: isDropdownOpen
                    ? "1px solid #0969da"
                    : "1px solid #d0d7de",
                  backgroundColor: isMetadataLocked ? "#f6f8fa" : "#ffffff",
                  borderRadius: "6px",
                  cursor: isMetadataLocked ? "not-allowed" : "pointer",
                  fontSize: "13px",
                  fontWeight: "600",
                  color: isDropdownOpen
                    ? "#0969da"
                    : isMetadataLocked
                      ? "#8c959f"
                      : "#24292f",
                  transition: "all 0.2s ease",
                  opacity: isMetadataLocked ? 0.7 : 1,
                }}
              >
                {activeFlowName}
                {isDropdownOpen ? (
                  <ChevronUp size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
              </button>

              {isDropdownOpen && !isMetadataLocked && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    marginTop: "4px",
                    width: "240px",
                    backgroundColor: "#ffffff",
                    border: "1px solid #d0d7de",
                    borderRadius: "8px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    zIndex: 50,
                    display: "flex",
                    flexDirection: "column",
                    padding: "8px 0",
                  }}
                >
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: "bold",
                      color: "#8c959f",
                      padding: "4px 16px 8px 16px",
                      letterSpacing: "0.5px",
                    }}
                  >
                    YOUR LOCAL FLOWS
                  </span>

                  {flows.map((flow) => (
                    <div
                      key={flow.id}
                      onClick={() => {
                        onSelectFlow?.(flow.id);
                        setIsDropdownOpen(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 16px",
                        cursor: "pointer",
                        backgroundColor:
                          activeFlowId === flow.id ? "#f0f7ff" : "transparent",
                        color: activeFlowId === flow.id ? "#0969da" : "#24292f",
                        fontSize: "13px",
                        fontWeight: "500",
                      }}
                      onMouseEnter={(e) => {
                        if (activeFlowId !== flow.id)
                          e.currentTarget.style.backgroundColor = "#f6f8fa";
                      }}
                      onMouseLeave={(e) => {
                        if (activeFlowId !== flow.id)
                          e.currentTarget.style.backgroundColor = "transparent";
                      }}
                    >
                      <span>{flow.name}</span>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        {activeFlowId === flow.id && (
                          <Check size={14} color="#0969da" />
                        )}
                        {activeFlowId !== flow.id && (
                          <button
                            onClick={(e) =>
                              handleDeleteClick(e, flow.id, flow.name)
                            }
                            style={{
                              background: "transparent",
                              border: "none",
                              padding: "4px",
                              cursor: "pointer",
                              color: "#8c959f",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                            title="Delete Flow"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!isMetadataLocked && (
              <button
                onClick={onCreateFlow}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "6px 8px",
                  border: "1px solid #d0d7de",
                  backgroundColor: "#f6f8fa",
                  borderRadius: "6px",
                  cursor: "pointer",
                  color: "#0969da",
                  transition: "all 0.2s ease",
                }}
              >
                <Plus size={16} />
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {isEditingTitle && !isMetadataLocked ? (
            <input
              autoFocus
              value={editTitleValue}
              onChange={(e) => setEditTitleValue(e.target.value)}
              onBlur={submitTitleEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitTitleEdit();
                }
                if (e.key === "Escape") setIsEditingTitle(false);
              }}
              style={{
                fontSize: "24px",
                fontWeight: "bold",
                color: "#24292f",
                margin: 0,
                padding: "0 4px",
                border: "1px solid #0969da",
                borderRadius: "4px",
                outline: "none",
                width: "300px",
              }}
            />
          ) : (
            <h1
              style={{
                fontSize: "24px",
                fontWeight: "bold",
                color: "#24292f",
                margin: 0,
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              {activeFlowName}
              {!isMetadataLocked && (
                <button
                  onClick={startEditing}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: "#8c959f",
                    display: "flex",
                    padding: 0,
                  }}
                >
                  <Pencil size={16} />
                </button>
              )}
            </h1>
          )}

          {isMetadataLocked ? (
            <span
              style={{
                fontSize: "11px",
                fontWeight: "600",
                color: "#0969da",
                backgroundColor: "#ddf4ff",
                padding: "4px 10px",
                borderRadius: "12px",
              }}
            >
              Version {metadata?.version || "1.0"}
            </span>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                backgroundColor: "#ddf4ff",
                padding: "4px 10px",
                borderRadius: "12px",
                border: "1px solid transparent",
                transition: "border-color 0.2s ease",
              }}
              onFocus={(e) =>
                (e.currentTarget.style.border = "1px solid #0969da")
              }
              onBlur={(e) =>
                (e.currentTarget.style.border = "1px solid transparent")
              }
            >
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: "600",
                  color: "#0969da",
                  marginRight: "4px",
                }}
              >
                Version
              </span>
              <input
                type="text"
                value={metadata?.version || ""}
                onChange={(e) =>
                  onMetadataChange?.({ ...metadata!, version: e.target.value })
                }
                placeholder="1.0"
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#0969da",
                  fontWeight: "600",
                  fontSize: "11px",
                  outline: "none",
                  padding: 0,
                  margin: 0,
                  width: metadata?.version
                    ? `${metadata.version.length + 1}ch`
                    : "4ch",
                  minWidth: "20px",
                }}
              />
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            fontSize: "12px",
            color: "#8c959f",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            Test Plan:
            {isMetadataLocked ? (
              <strong style={{ color: "#24292f", fontWeight: "600" }}>
                {metadata?.testPlan || "N/A"}
              </strong>
            ) : (
              <input
                type="text"
                placeholder="Click to add"
                value={metadata?.testPlan || ""}
                onChange={(e) =>
                  onMetadataChange?.({ ...metadata!, testPlan: e.target.value })
                }
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#24292f",
                  fontWeight: "600",
                  fontSize: "12px",
                  outline: "none",
                  padding: "0 0 2px 0",
                  width: "140px",
                  borderBottom: "1px dashed #d0d7de",
                  transition: "border-color 0.2s ease",
                }}
                onFocus={(e) =>
                  (e.target.style.borderBottom = "1px solid #0969da")
                }
                onBlur={(e) =>
                  (e.target.style.borderBottom = "1px dashed #d0d7de")
                }
              />
            )}
          </span>
          <span
            style={{ color: "#0969da", fontSize: "16px", lineHeight: "10px" }}
          >
            •
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            Environment:
            {isMetadataLocked ? (
              <strong style={{ color: "#24292f", fontWeight: "600" }}>
                {metadata?.environment || "Local"}
              </strong>
            ) : (
              <select
                value={metadata?.environment || "Local"}
                onChange={(e) =>
                  onMetadataChange?.({
                    ...metadata!,
                    environment: e.target.value,
                  })
                }
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#24292f",
                  fontWeight: "600",
                  fontSize: "12px",
                  outline: "none",
                  cursor: "pointer",
                  padding: "0 0 2px 0",
                  borderBottom: "1px dashed #d0d7de",
                }}
              >
                <option value="Local">Local</option>
                <option value="Dev">Dev</option>
                <option value="Staging">Staging</option>
                <option value="Prod">Prod</option>
              </select>
            )}
          </span>
          <span
            style={{ color: "#2da44e", fontSize: "16px", lineHeight: "10px" }}
          >
            •
          </span>
          <span>
            Last exported: {getRelativeTime(metadata?.lastUpdatedAt)} by{" "}
            <strong style={{ color: "#24292f", fontWeight: "600" }}>
              {metadata?.lastUpdatedBy || "Local User"}
            </strong>
          </span>

          {metadata?.testedBy && (
            <>
              <span
                style={{
                  color: "#d0d7de",
                  fontSize: "16px",
                  lineHeight: "10px",
                }}
              >
                |
              </span>
              <span>
                Tested by:{" "}
                <strong style={{ color: "#24292f", fontWeight: "600" }}>
                  {metadata.testedBy}
                </strong>
              </span>
            </>
          )}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          backgroundColor: "#f6f8fa",
          borderRadius: "8px",
          padding: "4px",
          border: "1px solid #e1e4e8",
          top: "16px",
        }}
      >
        <button
          onClick={() => onModeChange(WorkspaceMode.Design)}
          style={{
            padding: "6px 16px",
            borderRadius: "6px",
            border: "none",
            fontSize: "13px",
            fontWeight: activeMode === WorkspaceMode.Design ? "bold" : "normal",
            backgroundColor:
              activeMode === WorkspaceMode.Design ? "#ffffff" : "transparent",
            color: activeMode === WorkspaceMode.Design ? "#0969da" : "#57606a",
            boxShadow:
              activeMode === WorkspaceMode.Design
                ? "0 1px 3px rgba(0,0,0,0.1)"
                : "none",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
        >
          Design Mode
        </button>
        <button
          onClick={() => onModeChange(WorkspaceMode.Execution)}
          style={{
            padding: "6px 16px",
            borderRadius: "6px",
            border: "none",
            fontSize: "13px",
            fontWeight:
              activeMode === WorkspaceMode.Execution ? "bold" : "normal",
            backgroundColor:
              activeMode === WorkspaceMode.Execution
                ? "#ffffff"
                : "transparent",
            color:
              activeMode === WorkspaceMode.Execution ? "#0969da" : "#57606a",
            boxShadow:
              activeMode === WorkspaceMode.Execution
                ? "0 1px 3px rgba(0,0,0,0.1)"
                : "none",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
        >
          Execution Mode
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: "12px",
          flex: 1,
          justifyContent: "flex-end",
          alignItems: "flex-start",
        }}
      >
        {activeMode === WorkspaceMode.Design && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              backgroundColor: "#f6f8fa",
              borderRadius: "6px",
              border: "1px solid #d0d7de",
              padding: "2px",
            }}
          >
            <button
              onClick={onZoomOut}
              title="Zoom Out"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "6px",
                display: "flex",
                color: "#57606a",
                borderRadius: "4px",
              }}
            >
              <ZoomOut size={16} />
            </button>

            <button
              onClick={onZoomReset}
              title="Reset Zoom"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: "600",
                color: "#24292f",
                padding: "0 8px",
              }}
            >
              {Math.round(zoomLevel * 100)}%
            </button>

            <button
              onClick={onZoomIn}
              title="Zoom In"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "6px",
                display: "flex",
                color: "#57606a",
                borderRadius: "4px",
              }}
            >
              <ZoomIn size={16} />
            </button>
          </div>
        )}

        <button
          onClick={handleSaveClick}
          disabled={isSaving}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 16px",
            backgroundColor: isSaving ? "#f6f8fa" : "#ffffff",
            border: "1px solid #d0d7de",
            borderRadius: "6px",
            fontSize: "13px",
            fontWeight: "600",
            color: isSaving ? "#8c959f" : "#24292f",
            cursor: isSaving ? "not-allowed" : "pointer",
            transition: "all 0.2s ease",
          }}
        >
          {isSaving ? (
            <>
              <Loader2 size={16} /> Exporting...
            </>
          ) : (
            <>
              <Download size={16} /> Save
            </>
          )}
        </button>
      </div>
    </div>
  );
};

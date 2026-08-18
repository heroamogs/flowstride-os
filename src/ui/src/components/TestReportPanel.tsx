import { useState, useEffect, useRef } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  FileText,
  Image as ImageIcon,
  Video,
  User,
  ChevronDown,
  X,
  Upload,
  Save,
  Loader2,
} from "lucide-react";

export interface ExecutionReportStep {
  id: number;
  title: string;
  description: string;
  status: string;
  group_title?: string;
  defect_report?: string;
  defect_media?: string;
  assigned_to?: string;
}

interface TestReportPanelProps {
  report?: ExecutionReportStep[];
  onDefectSubmit?: (
    stepId: number,
    defectReport: string,
    defectMedia: string,
    assignedTo: string,
  ) => void;
  isReadOnly?: boolean; // STRICT MICRO-STEP: Read-only lock prop
}

export const TestReportPanel = ({
  report = [],
  onDefectSubmit,
  isReadOnly = false,
}: TestReportPanelProps) => {
  const [expandedArtifactStepId, setExpandedArtifactStepId] = useState<
    number | null
  >(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const [activeModalArtifact, setActiveModalArtifact] = useState<{
    stepId: number;
    type: string;
  } | null>(null);

  // STRICT MICRO-STEP: Super-Overlay state for native Lightbox Z-Index Stacking
  const [previewMedia, setPreviewMedia] = useState<{
    url: string;
    type: "video" | "image";
  } | null>(null);

  const [activeDefectData, setActiveDefectData] = useState({
    report: "",
    media: "",
    assignedTo: "",
  });

  const defectFileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingDefect, setIsUploadingDefect] = useState(false);
  const [isDeletingDefect, setIsDeletingDefect] = useState(false);

  const totalSteps = report.length;
  const passedSteps = report.filter((s) => s.status === "Passed").length;
  const failedSteps = report.filter((s) => s.status === "Failed").length;
  const blockedSteps = report.filter((s) => s.status === "Blocked").length;
  const skippedSteps = report.filter((s) => s.status === "Skipped").length;

  const passedPct = totalSteps === 0 ? 0 : (passedSteps / totalSteps) * 100;
  const failedPct = totalSteps === 0 ? 0 : (failedSteps / totalSteps) * 100;
  const blockedPct = totalSteps === 0 ? 0 : (blockedSteps / totalSteps) * 100;
  const skippedPct = totalSteps === 0 ? 0 : (skippedSteps / totalSteps) * 100;
  const remainingPct = 100 - passedPct - failedPct - blockedPct - skippedPct;

  useEffect(() => {
    const currentStep = report.find((s) => s.status === "Current");
    if (currentStep && currentStep.group_title) {
      setExpandedGroup(currentStep.group_title);
    }
  }, [report]);

  const groupedSteps: { groupName: string; steps: ExecutionReportStep[] }[] =
    [];
  report.forEach((step) => {
    const gName = step.group_title || "";
    let existingGroup = groupedSteps.find((g) => g.groupName === gName);
    if (!existingGroup) {
      existingGroup = { groupName: gName, steps: [] };
      groupedSteps.push(existingGroup);
    }
    existingGroup.steps.push(step);
  });

  const getStepStatusStyles = (status: string) => {
    switch (status) {
      case "Passed":
        return {
          dotBg: "#10b981",
          dotRing: "#d1fae5",
          cardBorder: "#a7f3d0",
          cardBg: "rgba(236, 253, 245, 0.5)",
          badgeBg: "#d1fae5",
          badgeText: "#047857",
          label: "PASSED",
        };
      case "Failed":
        return {
          dotBg: "#ef4444",
          dotRing: "#fee2e2",
          cardBorder: "#fecaca",
          cardBg: "rgba(254, 242, 242, 0.5)",
          badgeBg: "#fee2e2",
          badgeText: "#b91c1c",
          label: "FAILED",
        };
      case "Blocked":
        return {
          dotBg: "#f59e0b",
          dotRing: "#fef3c7",
          cardBorder: "#fde68a",
          cardBg: "rgba(255, 251, 235, 0.5)",
          badgeBg: "#fef3c7",
          badgeText: "#b45309",
          label: "BLOCKED",
        };
      case "Skipped":
        return {
          dotBg: "#a855f7",
          dotRing: "#f3e8ff",
          cardBorder: "#e9d5ff",
          cardBg: "rgba(250, 245, 255, 0.5)",
          badgeBg: "#f3e8ff",
          badgeText: "#7e22ce",
          label: "SKIPPED",
        };
      case "Current":
        return {
          dotBg: "#3b82f6",
          dotRing: "#dbeafe",
          cardBorder: "#bfdbfe",
          cardBg: "#ffffff",
          badgeBg: "#dbeafe",
          badgeText: "#1d4ed8",
          label: "CURRENT",
        };
      default:
        return {
          dotBg: "#cbd5e1",
          dotRing: "#f1f5f9",
          cardBorder: "#e2e8f0",
          cardBg: "#ffffff",
          badgeBg: "#f1f5f9",
          badgeText: "#475569",
          label: "PENDING",
        };
    }
  };

  const handleOpenArtifact = (stepId: number, type: string) => {
    const stepData = report.find((s) => s.id === stepId);
    setActiveDefectData({
      report: stepData?.defect_report || "",
      media: stepData?.defect_media || "",
      assignedTo: stepData?.assigned_to || "",
    });
    setActiveModalArtifact({ stepId, type });
  };

  const handleCloseModal = () => {
    setActiveModalArtifact(null);
  };

  const handleSaveDefect = () => {
    if (!activeModalArtifact || isReadOnly) return;

    onDefectSubmit?.(
      activeModalArtifact.stepId,
      activeDefectData.report,
      activeDefectData.media,
      activeDefectData.assignedTo,
    );

    handleCloseModal();
  };

  const handleDefectFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (isReadOnly) return;
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const currentMediaArray = activeDefectData.media.split(",").filter(Boolean);
    let tempVidCount = currentMediaArray.filter(
      (r) => r.endsWith(".mp4") || r.endsWith(".webm"),
    ).length;
    let tempImgCount = currentMediaArray.filter(
      (r) => !r.endsWith(".mp4") && !r.endsWith(".webm"),
    ).length;
    const newPaths: string[] = [];

    setIsUploadingDefect(true);

    for (const file of files) {
      const ext = "." + (file.name.split(".").pop()?.toLowerCase() || "");
      const isVideo = ext === ".mp4" || ext === ".webm";
      const isImage = [".png", ".jpg", ".jpeg", ".gif"].includes(ext);

      if (isVideo) {
        if (tempVidCount >= 4) {
          window.alert(
            "Architectural Limit Reached: Maximum 4 defect video clips allowed.",
          );
          continue;
        }
        if (file.size > 104857600) {
          window.alert(
            `Security Block: Video ${file.name} exceeds 100MB physical limit.`,
          );
          continue;
        }
        tempVidCount++;
      } else if (isImage) {
        if (tempImgCount >= 6) {
          window.alert(
            "Architectural Limit Reached: Maximum 6 defect images allowed.",
          );
          continue;
        }
        if (file.size > 5242880) {
          window.alert(
            `Security Block: Image ${file.name} exceeds 5MB physical limit.`,
          );
          continue;
        }
        tempImgCount++;
      } else {
        window.alert(`Security Block: Unsupported file format ${ext}.`);
        continue;
      }

      try {
        const res = await fetch("/api/upload-defect", {
          method: "POST",
          headers: { "X-File-Extension": ext },
          body: file,
        });

        if (!res.ok) throw new Error("Network response was not ok");

        const data = await res.json();
        if (data.url) {
          newPaths.push(data.url);
        }
      } catch (err) {
        window.alert(
          `Network Error: Failed to vault defect evidence ${file.name}.`,
        );
      }
    }

    if (newPaths.length > 0) {
      const updatedMedia = [...currentMediaArray, ...newPaths].join(",");
      setActiveDefectData({ ...activeDefectData, media: updatedMedia });
    }

    setIsUploadingDefect(false);
    if (defectFileInputRef.current) defectFileInputRef.current.value = "";
  };

  const handleDeleteDefectMedia = async (indexToDelete: number) => {
    if (isDeletingDefect || isReadOnly) return;

    const currentMediaArray = activeDefectData.media.split(",").filter(Boolean);
    const targetUrl = currentMediaArray[indexToDelete];
    if (!targetUrl) return;

    setIsDeletingDefect(true);

    try {
      const res = await fetch(
        `/api/defect-media?filepath=${encodeURIComponent(targetUrl)}`,
        {
          method: "DELETE",
        },
      );

      if (!res.ok && res.status !== 404) {
        throw new Error(`Server returned ${res.status}`);
      }

      const updatedArray = [...currentMediaArray];
      updatedArray.splice(indexToDelete, 1);
      setActiveDefectData({
        ...activeDefectData,
        media: updatedArray.join(","),
      });
    } catch (err) {
      console.error(
        "[Flowstride Security Alert]: Physical deletion of defect media failed.",
        err,
      );
      window.alert(
        "Security Block: Failed to physically remove defect media. Please try again.",
      );
    } finally {
      setIsDeletingDefect(false);
    }
  };

  return (
    <>
      <style>{`
        .flowstride-spin {
          animation: flowstride-spin-anim 1s linear infinite;
        }
        @keyframes flowstride-spin-anim {
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {/* STRICT MICRO-STEP: The Z-Index Stacking Preview Super-Overlay (Layer 10000) */}
      {previewMedia && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.9)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(4px)",
          }}
          onClick={() => setPreviewMedia(null)}
        >
          <div
            style={{
              position: "relative",
              maxWidth: "90%",
              maxHeight: "90%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setPreviewMedia(null)}
              title="Close Preview"
              style={{
                position: "absolute",
                top: "-40px",
                right: "0",
                background: "rgba(255, 255, 255, 0.1)",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                color: "#ffffff",
                borderRadius: "50%",
                padding: "6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.2s ease",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "rgba(255, 255, 255, 0.2)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)")
              }
            >
              <X size={20} />
            </button>

            {previewMedia.type === "video" ? (
              <video
                src={previewMedia.url}
                controls
                autoPlay
                style={{
                  maxWidth: "100%",
                  maxHeight: "85vh",
                  borderRadius: "8px",
                  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
                }}
              />
            ) : (
              <img
                src={previewMedia.url}
                alt="Defect Preview"
                style={{
                  maxWidth: "100%",
                  maxHeight: "85vh",
                  borderRadius: "8px",
                  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
                  objectFit: "contain",
                }}
              />
            )}
          </div>
        </div>
      )}

      <aside
        style={{
          width: "340px",
          backgroundColor: "#ffffff",
          borderLeft: "1px solid #e2e8f0",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          zIndex: 20,
          boxShadow: "-4px 0 15px -3px rgba(0,0,0,0.02)",
        }}
      >
        <div
          style={{
            padding: "20px",
            borderBottom: "1px solid #e2e8f0",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                backgroundColor: "#ecfdf5",
                color: "#059669",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid #d1fae5",
                flexShrink: 0,
              }}
            >
              <CheckCircle2 size={16} strokeWidth={2.5} />
            </div>
            <div>
              <h2
                style={{
                  fontSize: "15px",
                  fontWeight: "bold",
                  color: "#0f172a",
                  margin: 0,
                  lineHeight: "1.2",
                }}
              >
                Test Execution
              </h2>
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: "bold",
                  color: "#94a3b8",
                  marginTop: "2px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Live Report
              </div>
            </div>
          </div>

          <div
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: "6px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: "6px",
                  padding: "8px 0",
                }}
              >
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: "900",
                    color: "#334155",
                  }}
                >
                  {totalSteps}
                </span>
                <span
                  style={{
                    fontSize: "8px",
                    fontWeight: "bold",
                    color: "#94a3b8",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginTop: "2px",
                  }}
                >
                  Total
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#ecfdf5",
                  border: "1px solid #a7f3d0",
                  borderRadius: "6px",
                  padding: "8px 0",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
              >
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: "900",
                    color: "#047857",
                  }}
                >
                  {passedSteps}
                </span>
                <span
                  style={{
                    fontSize: "8px",
                    fontWeight: "bold",
                    color: "#059669",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginTop: "2px",
                  }}
                >
                  Passed
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: "6px",
                  padding: "8px 0",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
              >
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: "900",
                    color: "#b91c1c",
                  }}
                >
                  {failedSteps}
                </span>
                <span
                  style={{
                    fontSize: "8px",
                    fontWeight: "bold",
                    color: "#dc2626",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginTop: "2px",
                  }}
                >
                  Failed
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: "6px",
                  padding: "8px 0",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
              >
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: "900",
                    color: "#d97706",
                  }}
                >
                  {blockedSteps}
                </span>
                <span
                  style={{
                    fontSize: "8px",
                    fontWeight: "bold",
                    color: "#b45309",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginTop: "2px",
                  }}
                >
                  Blocked
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#faf5ff",
                  border: "1px solid #e9d5ff",
                  borderRadius: "6px",
                  padding: "8px 0",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
              >
                <span
                  style={{
                    fontSize: "14px",
                    fontWeight: "900",
                    color: "#7e22ce",
                  }}
                >
                  {skippedSteps}
                </span>
                <span
                  style={{
                    fontSize: "8px",
                    fontWeight: "bold",
                    color: "#9333ea",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginTop: "2px",
                  }}
                >
                  Skip
                </span>
              </div>
            </div>

            <div
              style={{
                width: "100%",
                height: "6px",
                backgroundColor: "#f1f5f9",
                borderRadius: "9999px",
                overflow: "hidden",
                display: "flex",
                boxShadow: "inset 0 2px 4px rgba(0,0,0,0.05)",
              }}
            >
              <div
                style={{
                  height: "100%",
                  backgroundColor: "#10b981",
                  width: `${passedPct}%`,
                  transition: "width 0.3s ease",
                }}
              ></div>
              <div
                style={{
                  height: "100%",
                  backgroundColor: "#ef4444",
                  width: `${failedPct}%`,
                  transition: "width 0.3s ease",
                }}
              ></div>
              <div
                style={{
                  height: "100%",
                  backgroundColor: "#f59e0b",
                  width: `${blockedPct}%`,
                  transition: "width 0.3s ease",
                }}
              ></div>
              <div
                style={{
                  height: "100%",
                  backgroundColor: "#a855f7",
                  width: `${skippedPct}%`,
                  transition: "width 0.3s ease",
                }}
              ></div>
              <div
                style={{
                  height: "100%",
                  backgroundColor: "#cbd5e1",
                  width: `${remainingPct}%`,
                  transition: "width 0.3s ease",
                }}
              ></div>
            </div>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px",
            backgroundColor: "#fafafa",
          }}
        >
          {report.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                color: "#94a3b8",
                fontSize: "13px",
                marginTop: "20px",
              }}
            >
              Waiting for execution layout...
            </div>
          ) : (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              {groupedSteps.map((group, groupIndex) => {
                const isUngrouped = group.groupName === "";
                const isGroupExpanded =
                  isUngrouped || expandedGroup === group.groupName;

                return (
                  <div
                    key={group.groupName || `ungrouped-${groupIndex}`}
                    style={{ marginBottom: isUngrouped ? "0" : "8px" }}
                  >
                    {!isUngrouped && (
                      <button
                        onClick={() =>
                          setExpandedGroup(
                            isGroupExpanded ? null : group.groupName,
                          )
                        }
                        style={{
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "12px 16px",
                          backgroundColor: isGroupExpanded
                            ? "#f8fafc"
                            : "#ffffff",
                          border: "1px solid #e2e8f0",
                          borderRadius: "8px",
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                          outline: "none",
                          boxShadow: isGroupExpanded
                            ? "none"
                            : "0 1px 2px rgba(0,0,0,0.02)",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "12px",
                            fontWeight: "bold",
                            color: isGroupExpanded ? "#0f172a" : "#475569",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {group.groupName}
                        </span>
                        <ChevronDown
                          size={16}
                          color="#94a3b8"
                          style={{
                            transform: isGroupExpanded
                              ? "rotate(180deg)"
                              : "none",
                            transition: "transform 0.2s ease",
                          }}
                        />
                      </button>
                    )}

                    {isGroupExpanded && (
                      <div
                        style={{
                          position: "relative",
                          borderLeft: "2px solid #e2e8f0",
                          marginLeft: isUngrouped ? "11px" : "27px",
                          paddingBottom: "8px",
                          marginTop: isUngrouped ? "0" : "16px",
                          transition: "all 0.3s ease",
                        }}
                      >
                        {group.steps.map((step) => {
                          const status = getStepStatusStyles(step.status);
                          const isExpanded = expandedArtifactStepId === step.id;
                          const isFailedOrBlocked =
                            status.label === "FAILED" ||
                            status.label === "BLOCKED";

                          return (
                            <div
                              key={step.id}
                              style={{
                                position: "relative",
                                paddingLeft: "24px",
                                marginBottom: "24px",
                              }}
                            >
                              <div
                                style={{
                                  position: "absolute",
                                  left: "-7px",
                                  top: "6px",
                                  width: "12px",
                                  height: "12px",
                                  borderRadius: "50%",
                                  backgroundColor: status.dotBg,
                                  boxShadow: `0 0 0 4px ${status.dotRing}`,
                                  zIndex: 10,
                                  transition:
                                    "background-color 0.3s ease, box-shadow 0.3s ease",
                                }}
                              ></div>

                              <div
                                style={{
                                  border: `1px solid ${status.cardBorder}`,
                                  borderRadius: "8px",
                                  padding: "14px",
                                  backgroundColor: status.cardBg,
                                  transition: "all 0.3s ease",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "flex-start",
                                    justifyContent: "space-between",
                                    gap: "8px",
                                    marginBottom: "6px",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: "10px",
                                      fontWeight: "bold",
                                      color: "#94a3b8",
                                      textTransform: "uppercase",
                                      letterSpacing: "0.05em",
                                    }}
                                  >
                                    Step {step.id}
                                  </div>
                                  <span
                                    style={{
                                      padding: "2px 8px",
                                      borderRadius: "4px",
                                      fontSize: "9px",
                                      fontWeight: "bold",
                                      textTransform: "uppercase",
                                      letterSpacing: "0.05em",
                                      backgroundColor: status.badgeBg,
                                      color: status.badgeText,
                                      transition: "all 0.3s ease",
                                    }}
                                  >
                                    {status.label}
                                  </span>
                                </div>
                                <h3
                                  style={{
                                    fontSize: "13px",
                                    fontWeight: "bold",
                                    color: "#0f172a",
                                    lineHeight: "1.4",
                                    margin: "0 0 4px 0",
                                  }}
                                >
                                  {step.title}
                                </h3>
                                <p
                                  style={{
                                    fontSize: "11px",
                                    color: "#64748b",
                                    lineHeight: "1.6",
                                    margin: 0,
                                  }}
                                >
                                  {step.description}
                                </p>

                                {isFailedOrBlocked && (
                                  <div style={{ marginTop: "12px" }}>
                                    <button
                                      onClick={() =>
                                        setExpandedArtifactStepId(
                                          isExpanded ? null : step.id,
                                        )
                                      }
                                      style={{
                                        width: "100%",
                                        padding: "6px 12px",
                                        backgroundColor: "#ffffff",
                                        border: `1px solid ${status.label === "FAILED" ? "#fecaca" : "#fde68a"}`,
                                        color:
                                          status.label === "FAILED"
                                            ? "#dc2626"
                                            : "#d97706",
                                        borderRadius: "4px",
                                        fontSize: "11px",
                                        fontWeight: "bold",
                                        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        cursor: "pointer",
                                        outline: "none",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: "6px",
                                        }}
                                      >
                                        <AlertTriangle
                                          size={14}
                                          strokeWidth={2.5}
                                        />
                                        {status.label === "FAILED"
                                          ? "Failure Details"
                                          : "Blocked Details"}
                                      </div>
                                      <ChevronDown
                                        size={14}
                                        strokeWidth={2.5}
                                        style={{
                                          transform: isExpanded
                                            ? "rotate(180deg)"
                                            : "none",
                                          transition: "transform 0.2s",
                                        }}
                                      />
                                    </button>

                                    {isExpanded && (
                                      <div
                                        style={{
                                          marginTop: "8px",
                                          paddingTop: "8px",
                                          borderTop: `1px solid ${status.label === "FAILED" ? "rgba(254, 202, 202, 0.6)" : "rgba(253, 230, 138, 0.6)"}`,
                                          display: "flex",
                                          flexDirection: "column",
                                          gap: "6px",
                                        }}
                                      >
                                        <button
                                          onClick={() =>
                                            handleOpenArtifact(
                                              step.id,
                                              status.label === "FAILED"
                                                ? "Failed Report"
                                                : "Blocked Report",
                                            )
                                          }
                                          style={{
                                            width: "100%",
                                            padding: "6px 8px",
                                            backgroundColor: "#ffffff",
                                            border: "1px solid #fee2e2",
                                            color: "#334155",
                                            borderRadius: "4px",
                                            fontSize: "11px",
                                            fontWeight: "600",
                                            boxShadow:
                                              "0 1px 2px rgba(0,0,0,0.05)",
                                            display: "flex",
                                            alignItems: "center",
                                            cursor: "pointer",
                                          }}
                                        >
                                          <FileText
                                            size={14}
                                            color={
                                              status.label === "FAILED"
                                                ? "#ef4444"
                                                : "#f59e0b"
                                            }
                                            style={{ marginRight: "8px" }}
                                          />{" "}
                                          {status.label === "FAILED"
                                            ? "Failed Report"
                                            : "Blocked Report"}
                                        </button>

                                        <button
                                          onClick={() =>
                                            handleOpenArtifact(
                                              step.id,
                                              "Screenshot",
                                            )
                                          }
                                          style={{
                                            width: "100%",
                                            padding: "6px 8px",
                                            backgroundColor: "#ffffff",
                                            border: "1px solid #fee2e2",
                                            color: "#334155",
                                            borderRadius: "4px",
                                            fontSize: "11px",
                                            fontWeight: "600",
                                            boxShadow:
                                              "0 1px 2px rgba(0,0,0,0.05)",
                                            display: "flex",
                                            alignItems: "center",
                                            cursor: "pointer",
                                          }}
                                        >
                                          <ImageIcon
                                            size={14}
                                            color="#6366f1"
                                            style={{ marginRight: "8px" }}
                                          />{" "}
                                          Screenshot
                                        </button>

                                        <button
                                          onClick={() =>
                                            handleOpenArtifact(
                                              step.id,
                                              "Video Clip",
                                            )
                                          }
                                          style={{
                                            width: "100%",
                                            padding: "6px 8px",
                                            backgroundColor: "#ffffff",
                                            border: "1px solid #fee2e2",
                                            color: "#334155",
                                            borderRadius: "4px",
                                            fontSize: "11px",
                                            fontWeight: "600",
                                            boxShadow:
                                              "0 1px 2px rgba(0,0,0,0.05)",
                                            display: "flex",
                                            alignItems: "center",
                                            cursor: "pointer",
                                          }}
                                        >
                                          <Video
                                            size={14}
                                            color="#10b981"
                                            style={{ marginRight: "8px" }}
                                          />{" "}
                                          Video Clip
                                        </button>

                                        <button
                                          onClick={() =>
                                            handleOpenArtifact(
                                              step.id,
                                              "Assigned To",
                                            )
                                          }
                                          style={{
                                            width: "100%",
                                            padding: "6px 8px",
                                            backgroundColor: "#ffffff",
                                            border: "1px solid #fee2e2",
                                            color: "#334155",
                                            borderRadius: "4px",
                                            fontSize: "11px",
                                            fontWeight: "600",
                                            boxShadow:
                                              "0 1px 2px rgba(0,0,0,0.05)",
                                            display: "flex",
                                            alignItems: "center",
                                            cursor: "pointer",
                                          }}
                                        >
                                          <User
                                            size={14}
                                            color="#f59e0b"
                                            style={{ marginRight: "8px" }}
                                          />{" "}
                                          Assigned To
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      {/* Layer 9999: The Defect Data Modal Overlay */}
      {activeModalArtifact && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={handleCloseModal}
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.6)",
              backdropFilter: "blur(2px)",
              cursor: "pointer",
            }}
          ></div>

          <div
            style={{
              position: "relative",
              width: "600px",
              backgroundColor: "#ffffff",
              borderRadius: "12px",
              boxShadow:
                "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px",
                borderBottom: "1px solid #f1f5f9",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "16px" }}
              >
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "8px",
                    backgroundColor: "#eef2ff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {activeModalArtifact.type === "Screenshot" && (
                    <ImageIcon size={20} color="#6366f1" />
                  )}
                  {activeModalArtifact.type === "Video Clip" && (
                    <Video size={20} color="#10b981" />
                  )}
                  {activeModalArtifact.type === "Failed Report" && (
                    <FileText size={20} color="#ef4444" />
                  )}
                  {activeModalArtifact.type === "Blocked Report" && (
                    <FileText size={20} color="#f59e0b" />
                  )}
                  {activeModalArtifact.type === "Assigned To" && (
                    <User size={20} color="#f59e0b" />
                  )}
                </div>
                <div>
                  <h3
                    style={{
                      fontSize: "18px",
                      fontWeight: "bold",
                      color: "#0f172a",
                      margin: "0 0 4px 0",
                    }}
                  >
                    {activeModalArtifact.type}
                  </h3>
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: "bold",
                      color: "#64748b",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    Step {activeModalArtifact.stepId}: DEFECT DATA
                  </div>
                </div>
              </div>
              <button
                onClick={handleCloseModal}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94a3b8",
                  cursor: "pointer",
                  padding: "4px",
                }}
              >
                <X size={20} />
              </button>
            </div>

            <div
              style={{
                padding: "40px 24px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#f8fafc",
              }}
            >
              {(activeModalArtifact.type === "Failed Report" ||
                activeModalArtifact.type === "Blocked Report") && (
                <textarea
                  autoFocus
                  readOnly={isReadOnly} // STRICT MICRO-STEP: Immutable constraint
                  value={activeDefectData.report}
                  onChange={(e) =>
                    !isReadOnly &&
                    setActiveDefectData({
                      ...activeDefectData,
                      report: e.target.value,
                    })
                  }
                  placeholder={`Enter detailed ${activeModalArtifact.type.toLowerCase()}...`}
                  style={{
                    width: "100%",
                    maxWidth: "500px",
                    minHeight: "150px",
                    padding: "12px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                    fontSize: "14px",
                    color: "#334155",
                    marginBottom: "24px",
                    resize: "vertical",
                    outline: "none",
                    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.05)",
                    backgroundColor: isReadOnly ? "#f1f5f9" : "#ffffff",
                    cursor: isReadOnly ? "not-allowed" : "text",
                  }}
                />
              )}

              {activeModalArtifact.type === "Assigned To" && (
                <div
                  style={{
                    width: "100%",
                    maxWidth: "300px",
                    marginBottom: "24px",
                  }}
                >
                  <label
                    style={{
                      fontSize: "12px",
                      fontWeight: "bold",
                      color: "#64748b",
                      marginBottom: "8px",
                      display: "block",
                    }}
                  >
                    Assign to team member:
                  </label>
                  <input
                    autoFocus
                    readOnly={isReadOnly} // STRICT MICRO-STEP: Immutable constraint
                    type="text"
                    value={activeDefectData.assignedTo}
                    onChange={(e) =>
                      !isReadOnly &&
                      setActiveDefectData({
                        ...activeDefectData,
                        assignedTo: e.target.value,
                      })
                    }
                    placeholder="e.g., Jane Doe"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      fontSize: "14px",
                      color: "#334155",
                      outline: "none",
                      boxShadow: "inset 0 1px 2px rgba(0,0,0,0.05)",
                      boxSizing: "border-box",
                      backgroundColor: isReadOnly ? "#f1f5f9" : "#ffffff",
                      cursor: isReadOnly ? "not-allowed" : "text",
                    }}
                  />
                </div>
              )}

              {(activeModalArtifact.type === "Screenshot" ||
                activeModalArtifact.type === "Video Clip") && (
                <div style={{ width: "100%", marginBottom: "24px" }}>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "12px",
                      justifyContent: "center",
                    }}
                  >
                    {activeDefectData.media
                      .split(",")
                      .filter(Boolean)
                      .map((url, i) => {
                        const isVid =
                          url.endsWith(".mp4") || url.endsWith(".webm");
                        return (
                          <div
                            key={`${url}-${i}`}
                            // STRICT MICRO-STEP: Clicking the thumbnail spawns the Layer 10000 preview
                            onClick={() =>
                              setPreviewMedia({
                                url,
                                type: isVid ? "video" : "image",
                              })
                            }
                            style={{
                              position: "relative",
                              width: "140px",
                              height: "100px",
                              borderRadius: "6px",
                              border: "1px solid #d0d7de",
                              overflow: "hidden",
                              backgroundColor: "#f6f8fa",
                              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                              cursor: "pointer",
                            }}
                          >
                            {isVid ? (
                              <video
                                src={url}
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover",
                                }}
                                muted
                                loop
                                playsInline
                                onMouseEnter={(e) =>
                                  e.currentTarget.play().catch(() => {})
                                }
                                onMouseLeave={(e) => {
                                  e.currentTarget.pause();
                                  e.currentTarget.currentTime = 0;
                                }}
                              />
                            ) : (
                              <img
                                src={url}
                                alt={`Defect Evidence ${i}`}
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover",
                                }}
                              />
                            )}

                            {/* STRICT MICRO-STEP: Mathematically strip the delete button if the record is read-only */}
                            {!isReadOnly && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation(); // Prevents the thumbnail preview from firing when attempting to delete
                                  handleDeleteDefectMedia(i);
                                }}
                                disabled={isDeletingDefect}
                                title="Remove Evidence"
                                style={{
                                  position: "absolute",
                                  top: "4px",
                                  right: "4px",
                                  background: "rgba(15, 23, 42, 0.7)",
                                  color: "#ffffff",
                                  border: "none",
                                  borderRadius: "50%",
                                  padding: "4px",
                                  cursor: isDeletingDefect
                                    ? "not-allowed"
                                    : "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  opacity: isDeletingDefect ? 0.5 : 1,
                                  transition: "background 0.2s ease",
                                }}
                              >
                                {isDeletingDefect ? (
                                  <Loader2
                                    size={14}
                                    className="flowstride-spin"
                                  />
                                ) : (
                                  <X size={14} />
                                )}
                              </button>
                            )}
                          </div>
                        );
                      })}
                  </div>

                  {activeDefectData.media.split(",").filter(Boolean).length ===
                    0 && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                      }}
                    >
                      <div
                        style={{
                          width: "64px",
                          height: "64px",
                          borderRadius: "50%",
                          backgroundColor: "#ffffff",
                          border: "1px solid #e2e8f0",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          marginBottom: "16px",
                        }}
                      >
                        {activeModalArtifact.type === "Screenshot" ? (
                          <ImageIcon size={28} color="#cbd5e1" />
                        ) : (
                          <Video size={28} color="#cbd5e1" />
                        )}
                      </div>
                      <p
                        style={{
                          fontSize: "14px",
                          color: "#475569",
                          textAlign: "center",
                          maxWidth: "300px",
                          lineHeight: "1.5",
                          margin: 0,
                        }}
                      >
                        {isReadOnly
                          ? "No evidence vaulted for this historical run."
                          : "No evidence vaulted yet. Upload a file below."}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* STRICT MICRO-STEP: Mathematically strip all mutation buttons if the record is read-only */}
              {!isReadOnly && (
                <div style={{ display: "flex", gap: "12px" }}>
                  {activeModalArtifact.type === "Screenshot" ||
                  activeModalArtifact.type === "Video Clip" ? (
                    <>
                      <input
                        type="file"
                        ref={defectFileInputRef}
                        onChange={handleDefectFileUpload}
                        multiple
                        accept=".png,.jpg,.jpeg,.gif,.mp4,.webm"
                        style={{ display: "none" }}
                      />
                      <button
                        onClick={() => defectFileInputRef.current?.click()}
                        disabled={isUploadingDefect}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          padding: "10px 20px",
                          backgroundColor: "#ffffff",
                          color: "#334155",
                          border: "1px solid #cbd5e1",
                          borderRadius: "8px",
                          fontSize: "14px",
                          fontWeight: "600",
                          cursor: isUploadingDefect ? "not-allowed" : "pointer",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                          opacity: isUploadingDefect ? 0.7 : 1,
                        }}
                      >
                        {isUploadingDefect ? (
                          <Loader2 size={16} className="flowstride-spin" />
                        ) : (
                          <Upload size={16} />
                        )}
                        {isUploadingDefect ? "Vaulting..." : "Upload Evidence"}
                      </button>
                    </>
                  ) : null}

                  <button
                    onClick={handleSaveDefect}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "10px 20px",
                      backgroundColor: "#4f46e5",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      fontSize: "14px",
                      fontWeight: "600",
                      cursor: "pointer",
                      boxShadow: "0 4px 6px -1px rgba(79, 70, 229, 0.2)",
                    }}
                  >
                    <Save size={16} /> Save Data
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

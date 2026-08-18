import { useState, useRef, useEffect } from "react";
import DOMPurify from "dompurify";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Link,
  Plus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
} from "lucide-react";

// Strictly define the props required to communicate live edits securely
interface PropertyEditorProps {
  entityType?: "Node" | "Group" | "Text";
  entityId?: number;
  visualStep?: string;
  title?: string;
  description?: string;
  stepsContent?: string;
  expectedResult?: string;
  referencesContent?: string;
  priority?: string;
  onTitleChange?: (newTitle: string) => void;
  onDescriptionChange?: (newDescription: string) => void;
  onStepsContentChange?: (newSteps: string) => void;
  onExpectedResultChange?: (newResult: string) => void;
  onReferencesChange?: (newRefs: string) => void;
  onPriorityChange?: (newPriority: string) => void;
}

// Mathematically secure, self contained WYSIWYG Editor Component
const RichTextEditorGroup = ({
  label,
  value,
  onChange,
  placeholder,
  minHeight,
  maxLength,
}: {
  label: string;
  value: string;
  onChange?: (val: string) => void;
  placeholder: string;
  minHeight: string;
  maxLength?: number;
}) => {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current && value !== editorRef.current.innerHTML) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const handleInput = () => {
    if (editorRef.current && onChange) {
      const rawHtml = editorRef.current.innerHTML;

      const cleanHtml = DOMPurify.sanitize(rawHtml, {
        ALLOWED_TAGS: [
          "b",
          "i",
          "em",
          "strong",
          "a",
          "ul",
          "ol",
          "li",
          "br",
          "div",
          "p",
          "font",
        ],
        ALLOWED_ATTR: ["href", "target", "rel", "size"],
      });
      onChange(cleanHtml);
    }
  };

  const applyCommand = (
    e: React.PointerEvent | React.ChangeEvent,
    command: string,
    arg?: string,
  ) => {
    e.preventDefault();
    document.execCommand(command, false, arg);
    handleInput();
  };

  const handleLink = (e: React.PointerEvent) => {
    e.preventDefault();
    const url = window.prompt("Enter link URL (e.g., https://example.com):");
    if (url) {
      document.execCommand("createLink", false, url);
      handleInput();
    }
  };

  const handleFontSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    applyCommand(e, "fontSize", e.target.value);
    if (editorRef.current) {
      editorRef.current.focus();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <label style={{ fontSize: "12px", fontWeight: "600", color: "#24292f" }}>
        {label}
      </label>
      <div
        style={{
          border: "1px solid #d0d7de",
          borderRadius: "6px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "4px",
            padding: "6px 8px",
            borderBottom: "1px solid #d0d7de",
            backgroundColor: "#f6f8fa",
            alignItems: "center",
          }}
        >
          <select
            onChange={handleFontSizeChange}
            defaultValue="3"
            style={{
              background: "#ffffff",
              border: "1px solid #d0d7de",
              color: "#24292f",
              borderRadius: "4px",
              padding: "2px 4px",
              fontSize: "12px",
              cursor: "pointer",
              outline: "none",
              marginRight: "4px",
            }}
            title="Font Size"
          >
            <option value="1">Small</option>
            <option value="3">Normal</option>
            <option value="4">Large</option>
            <option value="5">Huge</option>
          </select>

          <div
            style={{
              width: "1px",
              height: "16px",
              backgroundColor: "#d0d7de",
              margin: "0 4px",
            }}
          />

          <button
            onPointerDown={(e) => applyCommand(e, "bold")}
            style={{
              background: "none",
              border: "none",
              color: "#57606a",
              cursor: "pointer",
              padding: "4px",
              borderRadius: "4px",
            }}
            title="Bold"
          >
            <Bold size={14} />
          </button>
          <button
            onPointerDown={(e) => applyCommand(e, "italic")}
            style={{
              background: "none",
              border: "none",
              color: "#57606a",
              cursor: "pointer",
              padding: "4px",
              borderRadius: "4px",
            }}
            title="Italic"
          >
            <Italic size={14} />
          </button>
          <button
            onPointerDown={(e) => applyCommand(e, "insertUnorderedList")}
            style={{
              background: "none",
              border: "none",
              color: "#57606a",
              cursor: "pointer",
              padding: "4px",
              borderRadius: "4px",
            }}
            title="Bulleted List"
          >
            <List size={14} />
          </button>
          <button
            onPointerDown={(e) => applyCommand(e, "insertOrderedList")}
            style={{
              background: "none",
              border: "none",
              color: "#57606a",
              cursor: "pointer",
              padding: "4px",
              borderRadius: "4px",
            }}
            title="Numbered List"
          >
            <ListOrdered size={14} />
          </button>
          <button
            onPointerDown={handleLink}
            style={{
              background: "none",
              border: "none",
              color: "#57606a",
              cursor: "pointer",
              padding: "4px",
              borderRadius: "4px",
            }}
            title="Link"
          >
            <Link size={14} />
          </button>
        </div>

        <div style={{ position: "relative" }}>
          <div
            ref={editorRef}
            className="rich-text-editor"
            contentEditable
            onInput={handleInput}
            onBlur={handleInput}
            data-placeholder={placeholder}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "none",
              fontSize: "13px",
              color: "#24292f",
              minHeight: minHeight,
              outline: "none",
              boxSizing: "border-box",
              backgroundColor: "#ffffff",
              overflowY: "auto",
              resize: "vertical",
              lineHeight: "1.5",
            }}
          />
          {maxLength && (
            <span
              style={{
                position: "absolute",
                bottom: "8px",
                right: "12px",
                fontSize: "10px",
                color: "#8c959f",
                pointerEvents: "none",
              }}
            >
              {value.replace(/<[^>]*>?/gm, "").length}/{maxLength}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export const PropertyEditor = ({
  entityType = "Node",
  entityId = 2,
  visualStep,
  title = "Enter Email",
  description = "",
  stepsContent = "",
  expectedResult = "",
  referencesContent = "",
  priority = "",
  onTitleChange,
  onDescriptionChange,
  onStepsContentChange,
  onExpectedResultChange,
  onReferencesChange,
  onPriorityChange,
}: PropertyEditorProps) => {
  const [activeRightTab, setActiveRightTab] = useState<
    "Details" | "Connections"
  >("Details");
  const [isExpanded, setIsExpanded] = useState(true);

  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isDragging, setIsDragging] = useState(false);

  const dragStartXRef = useRef(0);
  const startWidthRef = useRef(320);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isPriorityMenuOpen, setIsPriorityMenuOpen] = useState(false);

  const [previewMedia, setPreviewMedia] = useState<{
    url: string;
    type: "video" | "image";
  } | null>(null);

  const currentRefsArray = referencesContent.split(",").filter(Boolean);
  const currentVideoCount = currentRefsArray.filter(
    (r) => r.endsWith(".mp4") || r.endsWith(".webm"),
  ).length;
  const currentImageCount = currentRefsArray.filter(
    (r) => !r.endsWith(".mp4") && !r.endsWith(".webm"),
  ).length;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragStartXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const deltaX = dragStartXRef.current - e.clientX;
    let newWidth = startWidthRef.current + deltaX;
    if (newWidth < 260) newWidth = 260;
    if (newWidth > 800) newWidth = 800;
    setSidebarWidth(newWidth);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      setIsDragging(false);
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    let tempVidCount = currentVideoCount;
    let tempImgCount = currentImageCount;
    const newPaths: string[] = [];

    setIsUploading(true);

    for (const file of files) {
      const ext = "." + (file.name.split(".").pop()?.toLowerCase() || "");
      const isVideo = ext === ".mp4" || ext === ".webm";
      const isImage = [".png", ".jpg", ".jpeg", ".gif"].includes(ext);

      // STRICT MICRO STEP: Strict financial constraints enforced mathematically
      if (isVideo) {
        if (tempVidCount >= 1) {
          window.alert(
            "Architectural Limit Reached: Maximum 1 video clip allowed per step.",
          );
          continue;
        }
        if (file.size > 41943040) {
          window.alert(
            `Security Block: Video ${file.name} exceeds 40MB physical limit.`,
          );
          continue;
        }
        tempVidCount++;
      } else if (isImage) {
        if (tempImgCount >= 1) {
          window.alert(
            "Architectural Limit Reached: Maximum 1 image allowed per step.",
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
        const res = await fetch("/api/upload", {
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
        window.alert(`Network Error: Failed to vault ${file.name}.`);
      }
    }

    if (newPaths.length > 0) {
      const updatedRefs = [...currentRefsArray, ...newPaths].join(",");
      onReferencesChange?.(updatedRefs);
    }

    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDeleteRef = async (indexToDelete: number) => {
    if (isDeleting) return;

    const targetUrl = currentRefsArray[indexToDelete];
    if (!targetUrl) return;

    setIsDeleting(true);

    try {
      const res = await fetch(
        `/api/media?filepath=${encodeURIComponent(targetUrl)}`,
        {
          method: "DELETE",
        },
      );

      if (!res.ok && res.status !== 404) {
        throw new Error(`Server returned ${res.status}`);
      }

      const updatedArray = [...currentRefsArray];
      updatedArray.splice(indexToDelete, 1);
      onReferencesChange?.(updatedArray.join(","));
    } catch (err) {
      console.error(
        "[Flowstride Security Alert]: Physical deletion failed.",
        err,
      );
      window.alert(
        "Security Block: Failed to physically remove media from local hard drive. Please try again.",
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const priorityColors: Record<string, string> = {
    Low: "#2da44e",
    Medium: "#bf8700",
    High: "#cf222e",
    Critical: "#8250df",
  };

  const currentPriority = priority || "Low";
  const currentPriorityColor =
    priorityColors[currentPriority] || priorityColors.Low;

  return (
    <>
      <style>{`
        .rich-text-editor:empty::before {
          content: attr(data-placeholder);
          color: #8c959f;
          pointer-events: none;
        }
        .rich-text-editor a {
          color: #0969da;
          text-decoration: underline;
        }
        .rich-text-editor ul, .rich-text-editor ol {
          padding-left: 24px;
          margin: 4px 0;
        }
        .rich-text-editor p {
          margin: 0 0 4px 0;
        }
        .rich-text-editor div {
          margin: 0;
        }
        .rich-text-editor font[size="1"] { font-size: 10px; }
        .rich-text-editor font[size="3"] { font-size: 13px; }
        .rich-text-editor font[size="4"] { font-size: 18px; }
        .rich-text-editor font[size="5"] { font-size: 24px; }
        
        .rich-text-editor li:has(font[size="1"]) { font-size: 10px; }
        .rich-text-editor li:has(font[size="3"]) { font-size: 13px; }
        .rich-text-editor li:has(font[size="4"]) { font-size: 18px; }
        .rich-text-editor li:has(font[size="5"]) { font-size: 24px; }

        .flowstride-spin {
          animation: flowstride-spin-anim 1s linear infinite;
        }
        @keyframes flowstride-spin-anim {
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {previewMedia && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            backgroundColor: "rgba(0, 0, 0, 0.85)",
            zIndex: 9999,
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
                alt="Preview"
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
          width: isExpanded ? `${sidebarWidth}px` : "64px",
          backgroundColor: "#ffffff",
          borderLeft: "1px solid #e1e4e8",
          flexShrink: 0,
          transition: isDragging ? "none" : "width 0.2s ease",
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        {isExpanded && (
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              position: "absolute",
              left: "-3px",
              top: 0,
              bottom: 0,
              width: "6px",
              cursor: "col-resize",
              zIndex: 50,
              backgroundColor: isDragging ? "#0969da" : "transparent",
              transition: "background-color 0.2s ease",
            }}
            onMouseEnter={(e) => {
              if (!isDragging)
                e.currentTarget.style.backgroundColor = "#0969da";
            }}
            onMouseLeave={(e) => {
              if (!isDragging)
                e.currentTarget.style.backgroundColor = "transparent";
            }}
          />
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            overflowY: "auto",
            padding: isExpanded ? "24px 20px 80px 20px" : "16px 8px 16px 8px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: isExpanded ? "flex-start" : "center",
              gap: "12px",
              marginBottom: isExpanded ? "24px" : "16px",
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "4px",
                marginTop: isExpanded ? "4px" : "0",
                background: "transparent",
                border: "none",
                color: "#8c959f",
                cursor: "pointer",
                transition: "color 0.2s ease",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#24292f")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#8c959f")}
              title={
                isExpanded
                  ? "Collapse Property Editor"
                  : "Expand Property Editor"
              }
            >
              {isExpanded ? (
                <ChevronRight size={18} />
              ) : (
                <ChevronLeft size={18} />
              )}
            </button>

            {isExpanded && (
              <div
                style={{ display: "flex", flexDirection: "column", flex: 1 }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: "bold",
                    color: "#57606a",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    marginBottom: "2px",
                  }}
                >
                  {entityType === "Group"
                    ? `Group ${entityId}`
                    : entityType === "Text"
                      ? `Text Block ${entityId}`
                      : `Step ${visualStep || entityId}`}
                </span>
                <span
                  style={{
                    fontSize: "16px",
                    fontWeight: "600",
                    color: "#24292f",
                    wordBreak: "break-word",
                  }}
                >
                  {entityType === "Text" ? "Edit Text" : title}
                </span>
              </div>
            )}
          </div>

          {isExpanded && (
            <>
              {entityType !== "Text" && (
                <div
                  style={{
                    display: "flex",
                    borderBottom: "1px solid #e1e4e8",
                    marginBottom: "24px",
                    flexShrink: 0,
                  }}
                >
                  <button
                    onClick={() => setActiveRightTab("Details")}
                    style={{
                      padding: "8px 0",
                      marginRight: "24px",
                      background: "transparent",
                      border: "none",
                      borderBottom:
                        activeRightTab === "Details"
                          ? "2px solid #0969da"
                          : "2px solid transparent",
                      color:
                        activeRightTab === "Details" ? "#0969da" : "#57606a",
                      fontWeight: activeRightTab === "Details" ? "600" : "500",
                      fontSize: "13px",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                  >
                    Details
                  </button>
                  <button
                    onClick={() => setActiveRightTab("Connections")}
                    style={{
                      padding: "8px 0",
                      background: "transparent",
                      border: "none",
                      borderBottom:
                        activeRightTab === "Connections"
                          ? "2px solid #0969da"
                          : "2px solid transparent",
                      color:
                        activeRightTab === "Connections"
                          ? "#0969da"
                          : "#57606a",
                      fontWeight:
                        activeRightTab === "Connections" ? "600" : "500",
                      fontSize: "13px",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                  >
                    Connections
                  </button>
                </div>
              )}

              {activeRightTab === "Details" || entityType === "Text" ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "20px",
                    flex: 1,
                  }}
                >
                  {entityType === "Text" ? (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                      }}
                    >
                      <label
                        style={{
                          fontSize: "12px",
                          fontWeight: "600",
                          color: "#24292f",
                        }}
                      >
                        Text Content
                      </label>
                      <textarea
                        value={title}
                        onChange={(e) => onTitleChange?.(e.target.value)}
                        placeholder="Type your text here..."
                        style={{
                          width: "100%",
                          padding: "12px",
                          border: "1px solid #0969da",
                          borderRadius: "6px",
                          fontSize: "14px",
                          color: "#24292f",
                          minHeight: "120px",
                          resize: "vertical",
                          outline: "none",
                          boxShadow: "0 0 0 3px rgba(9, 105, 218, 0.3)",
                          boxSizing: "border-box",
                          lineHeight: "1.5",
                        }}
                      />
                    </div>
                  ) : (
                    <>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                        }}
                      >
                        <label
                          style={{
                            fontSize: "12px",
                            fontWeight: "600",
                            color: "#24292f",
                          }}
                        >
                          {entityType === "Group" ? "Group Name" : "Step Name"}{" "}
                          <span style={{ color: "#cf222e" }}>*</span>
                        </label>
                        <input
                          type="text"
                          value={title}
                          onChange={(e) => onTitleChange?.(e.target.value)}
                          style={{
                            padding: "8px 12px",
                            border: "1px solid #d0d7de",
                            borderRadius: "6px",
                            fontSize: "13px",
                            color: "#24292f",
                            outline: "none",
                            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.04)",
                          }}
                        />
                      </div>

                      {entityType === "Node" && (
                        <>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "6px",
                            }}
                          >
                            <label
                              style={{
                                fontSize: "12px",
                                fontWeight: "600",
                                color: "#24292f",
                              }}
                            >
                              Description
                            </label>
                            <div style={{ position: "relative" }}>
                              <textarea
                                value={description}
                                onChange={(e) =>
                                  onDescriptionChange?.(e.target.value)
                                }
                                placeholder="Enter description here..."
                                style={{
                                  width: "100%",
                                  padding: "8px 12px",
                                  border: "1px solid #d0d7de",
                                  borderRadius: "6px",
                                  fontSize: "13px",
                                  color: "#24292f",
                                  minHeight: "70px",
                                  resize: "vertical",
                                  outline: "none",
                                  boxShadow: "inset 0 1px 2px rgba(0,0,0,0.04)",
                                  boxSizing: "border-box",
                                }}
                              />
                              <span
                                style={{
                                  position: "absolute",
                                  bottom: "8px",
                                  right: "12px",
                                  fontSize: "10px",
                                  color: "#8c959f",
                                }}
                              >
                                {description.length}/500
                              </span>
                            </div>
                          </div>

                          <RichTextEditorGroup
                            label="Steps"
                            value={stepsContent}
                            onChange={onStepsContentChange}
                            placeholder="Enter steps to reproduce..."
                            minHeight="80px"
                          />

                          <RichTextEditorGroup
                            label="Expected Result"
                            value={expectedResult}
                            onChange={onExpectedResultChange}
                            placeholder="e.g., The system securely processes the valid input and proceeds."
                            minHeight="80px"
                            maxLength={500}
                          />

                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "6px",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                              }}
                            >
                              <label
                                style={{
                                  fontSize: "12px",
                                  fontWeight: "600",
                                  color: "#24292f",
                                }}
                              >
                                References
                              </label>
                              <span
                                style={{
                                  fontSize: "10px",
                                  color: "#8c959f",
                                  fontWeight: "500",
                                }}
                              >
                                Videos: {currentVideoCount}/1 &nbsp;•&nbsp;
                                Images: {currentImageCount}/1
                              </span>
                            </div>

                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: "8px",
                              }}
                            >
                              {currentRefsArray.map((url, i) => {
                                const isVid =
                                  url.endsWith(".mp4") || url.endsWith(".webm");
                                return (
                                  <div
                                    key={`${url}-${i}`}
                                    onClick={() =>
                                      setPreviewMedia({
                                        url,
                                        type: isVid ? "video" : "image",
                                      })
                                    }
                                    style={{
                                      position: "relative",
                                      width: "80px",
                                      height: "60px",
                                      borderRadius: "6px",
                                      border: "1px solid #d0d7de",
                                      overflow: "hidden",
                                      backgroundColor: "#f6f8fa",
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
                                        alt={`Reference ${i}`}
                                        style={{
                                          width: "100%",
                                          height: "100%",
                                          objectFit: "cover",
                                        }}
                                      />
                                    )}

                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteRef(i);
                                      }}
                                      disabled={isDeleting}
                                      title="Remove Reference"
                                      style={{
                                        position: "absolute",
                                        top: "4px",
                                        right: "4px",
                                        background: "rgba(36, 41, 47, 0.7)",
                                        color: "#ffffff",
                                        border: "none",
                                        borderRadius: "50%",
                                        padding: "2px",
                                        cursor: isDeleting
                                          ? "not-allowed"
                                          : "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        opacity: isDeleting ? 0.5 : 1,
                                      }}
                                    >
                                      {isDeleting ? (
                                        <Loader2
                                          size={12}
                                          className="flowstride-spin"
                                        />
                                      ) : (
                                        <X size={12} />
                                      )}
                                    </button>
                                  </div>
                                );
                              })}

                              {(currentVideoCount < 1 ||
                                currentImageCount < 1) && (
                                <>
                                  <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileUpload}
                                    multiple
                                    accept=".png,.jpg,.jpeg,.gif,.mp4,.webm"
                                    style={{ display: "none" }}
                                  />
                                  <button
                                    onClick={() =>
                                      fileInputRef.current?.click()
                                    }
                                    disabled={isUploading}
                                    style={{
                                      width: "80px",
                                      height: "60px",
                                      backgroundColor: isUploading
                                        ? "#f6f8fa"
                                        : "#ffffff",
                                      border: "1px dashed #0969da",
                                      borderRadius: "6px",
                                      display: "flex",
                                      flexDirection: "column",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      cursor: isUploading
                                        ? "not-allowed"
                                        : "pointer",
                                      color: isUploading
                                        ? "#8c959f"
                                        : "#0969da",
                                      transition: "all 0.2s ease",
                                    }}
                                  >
                                    {isUploading ? (
                                      <Loader2
                                        size={16}
                                        className="flowstride-spin"
                                        style={{ marginBottom: "4px" }}
                                      />
                                    ) : (
                                      <Plus
                                        size={16}
                                        style={{ marginBottom: "4px" }}
                                      />
                                    )}
                                    <span
                                      style={{
                                        fontSize: "11px",
                                        fontWeight: "500",
                                      }}
                                    >
                                      {isUploading ? "Vaulting..." : "Upload"}
                                    </span>
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          <div
                            style={{
                              position: "relative",
                              display: "flex",
                              flexDirection: "column",
                              gap: "6px",
                              marginBottom: "20px",
                              marginTop: "8px",
                            }}
                          >
                            <label
                              style={{
                                fontSize: "12px",
                                fontWeight: "600",
                                color: "#24292f",
                              }}
                            >
                              Priority
                            </label>
                            <button
                              onClick={() =>
                                setIsPriorityMenuOpen(!isPriorityMenuOpen)
                              }
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "8px 12px",
                                border: isPriorityMenuOpen
                                  ? "1px solid #0969da"
                                  : "1px solid #d0d7de",
                                borderRadius: "6px",
                                backgroundColor: "#ffffff",
                                cursor: "pointer",
                                outline: "none",
                                boxShadow: isPriorityMenuOpen
                                  ? "0 0 0 3px rgba(9, 105, 218, 0.3)"
                                  : "0 1px 2px rgba(0,0,0,0.04)",
                                transition: "all 0.2s ease",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                }}
                              >
                                <div
                                  style={{
                                    width: "8px",
                                    height: "8px",
                                    borderRadius: "50%",
                                    backgroundColor: currentPriorityColor,
                                  }}
                                ></div>
                                <span
                                  style={{
                                    fontSize: "13px",
                                    color: "#24292f",
                                    fontWeight: "500",
                                  }}
                                >
                                  {currentPriority}
                                </span>
                              </div>
                              <ChevronDown
                                size={14}
                                color="#57606a"
                                style={{
                                  transform: isPriorityMenuOpen
                                    ? "rotate(180deg)"
                                    : "rotate(0deg)",
                                  transition: "transform 0.2s ease",
                                }}
                              />
                            </button>

                            {isPriorityMenuOpen && (
                              <div
                                style={{
                                  position: "absolute",
                                  top: "100%",
                                  left: 0,
                                  right: 0,
                                  marginTop: "4px",
                                  backgroundColor: "#ffffff",
                                  border: "1px solid #d0d7de",
                                  borderRadius: "6px",
                                  boxShadow:
                                    "0 8px 24px rgba(140, 149, 159, 0.2)",
                                  zIndex: 100,
                                  display: "flex",
                                  flexDirection: "column",
                                  padding: "4px",
                                }}
                              >
                                {["Low", "Medium", "High", "Critical"].map(
                                  (tier) => (
                                    <button
                                      key={tier}
                                      onClick={() => {
                                        onPriorityChange?.(tier);
                                        setIsPriorityMenuOpen(false);
                                      }}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        padding: "8px",
                                        border: "none",
                                        backgroundColor: "transparent",
                                        cursor: "pointer",
                                        borderRadius: "4px",
                                        textAlign: "left",
                                      }}
                                      onMouseEnter={(e) =>
                                        (e.currentTarget.style.backgroundColor =
                                          "#f6f8fa")
                                      }
                                      onMouseLeave={(e) =>
                                        (e.currentTarget.style.backgroundColor =
                                          "transparent")
                                      }
                                    >
                                      <div
                                        style={{
                                          width: "8px",
                                          height: "8px",
                                          borderRadius: "50%",
                                          backgroundColor: priorityColors[tier],
                                        }}
                                      ></div>
                                      <span
                                        style={{
                                          fontSize: "13px",
                                          color: "#24292f",
                                        }}
                                      >
                                        {tier}
                                      </span>
                                    </button>
                                  ),
                                )}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <p
                    style={{
                      fontSize: "12px",
                      color: "#57606a",
                      fontFamily: "monospace",
                    }}
                  >
                    CONNECTIONS UI SCAFFOLD
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
};

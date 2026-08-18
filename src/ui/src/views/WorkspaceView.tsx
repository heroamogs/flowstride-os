import { useState, useRef, useEffect, useCallback } from "react";
import { WorkspaceMode } from "workspace_engine";
import toast, { Toaster } from "react-hot-toast";
import { useFlowStore } from "../store";
import { FlowCanvas } from "../components/FlowCanvas";
import { TopToolbar } from "../components/TopToolbar";
import type { FlowTemplateMeta, FlowMetadata } from "../components/TopToolbar";
import { ToolPalette } from "../components/ToolPalette";
import { PropertyEditor } from "../components/PropertyEditor";
import { TestReportPanel } from "../components/TestReportPanel";
import type { ExecutionReportStep } from "../components/TestReportPanel";

interface SelectedEntityState {
  type: "Node" | "Group" | "Text";
  id: number;
  title: string;
  description: string;
  visualStep?: string;
  stepsContent?: string;
  expectedResult?: string;
  references?: string;
  priority?: string;
}

export interface FlowCanvasImperativeAPI {
  exportDesignState: () => any;
  importDesignState: (parsedData: any) => void;
}

export const WorkspaceView = () => {
  const [activeMode, setActiveMode] = useState<WorkspaceMode>(
    WorkspaceMode.Design,
  );
  const [activeTool, setActiveTool] = useState<string>("Hand");
  const [selectedEntity, setSelectedEntity] =
    useState<SelectedEntityState | null>(null);
  const [executionReport, setExecutionReport] = useState<ExecutionReportStep[]>(
    [],
  );
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [recenterTrigger, setRecenterTrigger] = useState<number>(0);
  const [flows, setFlows] = useState<FlowTemplateMeta[]>([]);
  const [activeFlowId, setActiveFlowId] = useState<string | undefined>(
    undefined,
  );

  const [flowMetadata, setFlowMetadata] = useState<FlowMetadata>({
    flowName: "New Local Flow",
    version: "1.0",
    testPlan: "",
    environment: "Local",
    lastUpdatedBy: "Local User",
    lastUpdatedAt: Date.now(),
  });

  const { activeHistoricalRunId, setActiveHistoricalRunId } = useFlowStore();
  const canvasRef = useRef<FlowCanvasImperativeAPI>(null);

  const [defectTrigger, setDefectTrigger] = useState<{
    stepNumber: number;
    defectReport: string;
    defectMedia: string;
    assignedTo: string;
  } | null>(null);

  const handleDefectSubmit = useCallback(
    (
      stepNumber: number,
      defectReport: string,
      defectMedia: string,
      assignedTo: string,
    ) => {
      setDefectTrigger({ stepNumber, defectReport, defectMedia, assignedTo });
    },
    [],
  );

  const fetchTemplates = async () => {
    try {
      const response = await fetch("/api/templates");
      if (response.ok) {
        const data = await response.json();
        setFlows(data.templates || []);
      }
    } catch (error) {
      console.error(
        "[Flowstride Telemetry Error]: Failed to fetch local templates",
        error,
      );
      toast.error("Failed to connect to local file vault.");
    }
  };

  useEffect(() => {
    let isMounted = true;

    const initializeWorkspace = async () => {
      await fetchTemplates();

      if (!isMounted) return;

      if (activeHistoricalRunId) return;

      let lastFlowId: string | null = null;
      try {
        const stateRes = await fetch("/api/state");
        if (stateRes.ok) {
          const stateData = await stateRes.json();
          lastFlowId = stateData.activeFlowId;
        }
      } catch (err) {
        console.warn(
          "[Flowstride Telemetry]: Failed to read physical state vault.",
          err,
        );
      }

      if (!isMounted) return;

      if (lastFlowId && canvasRef.current) {
        try {
          const response = await fetch(
            `/api/template?filename=${encodeURIComponent(lastFlowId)}`,
          );
          if (response.ok) {
            const parsedData = await response.json();
            if (!isMounted) return;

            canvasRef.current.importDesignState(parsedData);

            if (parsedData.metadata) {
              setFlowMetadata(parsedData.metadata);
            }

            setActiveFlowId(lastFlowId);
            return;
          }
        } catch (e) {
          console.warn(
            "[Flowstride Telemetry]: Persisted flow missing, reverting to default.",
          );
        }
      }

      if (!isMounted) return;

      if (canvasRef.current) {
        canvasRef.current.importDesignState({
          nodes: [],
          groups: [],
          texts: [],
          connections: [],
        });

        setFlowMetadata({
          flowName: "New Local Flow",
          version: "1.0",
          testPlan: "",
          environment: "Local",
          lastUpdatedBy: "Local User",
          lastUpdatedAt: Date.now(),
        });

        const tempId = `unsaved-temp-${Date.now()}`;
        setFlows((prev) => [
          ...prev.filter((f) => !f.id.startsWith("unsaved-temp")),
          { id: tempId, name: "New Local Flow" },
        ]);
        setActiveFlowId(tempId);
      }
    };

    initializeWorkspace();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeFlowId === undefined) return;

    const syncState = async () => {
      const payloadId =
        activeFlowId && !activeFlowId.startsWith("unsaved-temp")
          ? activeFlowId
          : null;
      try {
        await fetch("/api/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activeFlowId: payloadId }),
        });
      } catch (err) {
        console.warn(
          "[Flowstride Telemetry]: Failed to sync physical state vault.",
          err,
        );
      }
    };

    syncState();
  }, [activeFlowId]);

  useEffect(() => {
    if (!activeHistoricalRunId) return;

    const loadHistoricalRun = async () => {
      try {
        const response = await fetch(
          `/api/run?filename=${encodeURIComponent(activeHistoricalRunId)}`,
        );
        if (!response.ok)
          throw new Error("Failed to fetch historical run payload");

        const parsedData = await response.json();

        if (canvasRef.current) {
          canvasRef.current.importDesignState(parsedData);

          if (parsedData.executionReport) {
            setExecutionReport(parsedData.executionReport);
          } else {
            setExecutionReport([]);
          }

          if (parsedData.metadata) {
            setFlowMetadata(parsedData.metadata);
          }

          setActiveFlowId(undefined);
          setSelectedEntity(null);
          setActiveMode(WorkspaceMode.Execution);

          toast.success("Historical record loaded successfully.");
        }
      } catch (error) {
        console.error(
          "[Flowstride Telemetry Error]: Historical load failed",
          error,
        );
        toast.error("Failed to load the historical run.");
      }
    };

    loadHistoricalRun();
  }, [activeHistoricalRunId]);

  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 0.1, 3.0));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(prev - 0.1, 0.25));
  };

  const handleZoomReset = () => {
    setZoomLevel(1.0);
    setRecenterTrigger((prev) => prev + 1);
  };

  const handleEntitySelected = (
    id: number | null,
    title: string,
    description: string,
    entityType: "Node" | "Group" | "Text" = "Node",
    visualStep?: string,
    stepsContent?: string,
    expectedResult?: string,
    references?: string,
    priority?: string,
  ) => {
    if (id === null) {
      setSelectedEntity(null);
    } else {
      setSelectedEntity({
        type: entityType,
        id,
        title,
        description,
        visualStep,
        stepsContent,
        expectedResult,
        references,
        priority,
      });
    }
  };

  const handleSelectFlow = async (id: string) => {
    if (activeHistoricalRunId) setActiveHistoricalRunId(null);

    setFlows((prev) =>
      prev.filter((f) => !f.id.startsWith("unsaved-temp") || f.id === id),
    );

    if (id.startsWith("unsaved-temp")) {
      if (canvasRef.current) {
        canvasRef.current.importDesignState({
          nodes: [],
          groups: [],
          texts: [],
          connections: [],
        });
        setActiveFlowId(id);
        setSelectedEntity(null);
      }
      return;
    }

    try {
      const response = await fetch(
        `/api/template?filename=${encodeURIComponent(id)}`,
      );
      if (!response.ok) throw new Error("Failed to fetch template payload");

      const parsedData = await response.json();

      if (canvasRef.current) {
        canvasRef.current.importDesignState(parsedData);

        if (parsedData.metadata) {
          setFlowMetadata(parsedData.metadata);
        } else {
          setFlowMetadata({
            flowName: "New Local Flow",
            version: "1.0",
            testPlan: "",
            environment: "Local",
            lastUpdatedBy: "Local User",
            lastUpdatedAt: Date.now(),
          });
        }

        setActiveFlowId(id);
        setSelectedEntity(null);
        toast.success(`Loaded ${id.replace(".json", "")}`);
      }
    } catch (error) {
      console.error(
        "[Flowstride Telemetry Error]: Blueprint load failed",
        error,
      );
      toast.error("Failed to load the selected flow.");
    }
  };

  const handleCreateFlow = () => {
    if (activeHistoricalRunId) setActiveHistoricalRunId(null);

    if (canvasRef.current) {
      canvasRef.current.importDesignState({
        nodes: [],
        groups: [],
        texts: [],
        connections: [],
      });

      setFlowMetadata({
        flowName: "New Local Flow",
        version: "1.0",
        testPlan: "",
        environment: "Local",
        lastUpdatedBy: "Local User",
        lastUpdatedAt: Date.now(),
      });

      const tempId = `unsaved-temp-${Date.now()}`;

      setFlows((prev) => [
        ...prev.filter((f) => !f.id.startsWith("unsaved-temp")),
        { id: tempId, name: "New Local Flow" },
      ]);
      setActiveFlowId(tempId);
      setSelectedEntity(null);
    }
  };

  const handleDeleteFlow = async (id: string) => {
    try {
      if (id.startsWith("unsaved-temp")) {
        setFlows((prev) => prev.filter((f) => f.id !== id));
        if (activeFlowId === id) {
          setActiveFlowId(undefined);
          if (canvasRef.current) {
            canvasRef.current.importDesignState({
              nodes: [],
              groups: [],
              texts: [],
              connections: [],
            });
            setFlowMetadata({
              flowName: "New Local Flow",
              version: "1.0",
              testPlan: "",
              environment: "Local",
              lastUpdatedBy: "Local User",
              lastUpdatedAt: Date.now(),
            });
          }
        }
        toast.success("Temporary flow removed");
        return;
      }

      const response = await fetch(
        `/api/template?filename=${encodeURIComponent(id)}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        throw new Error(
          `Local backend rejected deletion with status: ${response.status}`,
        );
      }

      toast.success(`Deleted ${id.replace(".json", "")}`);

      await fetchTemplates();

      if (activeFlowId === id) {
        setActiveFlowId(undefined);
        setSelectedEntity(null);
        if (canvasRef.current) {
          canvasRef.current.importDesignState({
            nodes: [],
            groups: [],
            texts: [],
            connections: [],
          });
          setFlowMetadata({
            flowName: "New Local Flow",
            version: "1.0",
            testPlan: "",
            environment: "Local",
            lastUpdatedBy: "Local User",
            lastUpdatedAt: Date.now(),
          });
        }
      }
    } catch (error) {
      console.error(
        "[Flowstride Telemetry Error]: Failed to delete flow",
        error,
      );
      toast.error("Failed to delete flow securely.");
    }
  };

  const handleRenameFlow = (id: string, newName: string) => {
    setFlows((prevFlows) =>
      prevFlows.map((flow) =>
        flow.id === id ? { ...flow, name: newName } : flow,
      ),
    );
  };

  const handleSaveWorkspace = async (
    explicitFilename?: string,
  ): Promise<void> => {
    if (!canvasRef.current) {
      console.warn(
        "[Flowstride Telemetry]: Canvas bridge is not yet established.",
      );
      toast.error("System not fully initialized.");
      return;
    }

    try {
      const baseCanvasData = canvasRef.current.exportDesignState();

      const currentTimestamp = Date.now();
      const activeUser = "Local User";

      let baseName = "New Local Flow";
      let oldPhysicalFileToDelete: string | null = null;

      if (explicitFilename) {
        baseName = explicitFilename;
        if (
          activeFlowId &&
          !activeFlowId.startsWith("unsaved-temp") &&
          activeFlowId !== `${explicitFilename}.json`
        ) {
          oldPhysicalFileToDelete = activeFlowId;
        }
      } else if (activeFlowId) {
        if (activeFlowId.startsWith("unsaved-temp")) {
          const tempFlow = flows.find((f) => f.id === activeFlowId);
          if (tempFlow) {
            baseName = tempFlow.name;
          }
        } else {
          baseName = activeFlowId.replace(".json", "");
        }
      }

      let canvasData: any;

      if (activeMode === WorkspaceMode.Execution) {
        const runMetadata = {
          ...flowMetadata,
          flowName: baseName,
          testedBy: activeUser,
          lastUpdatedAt: currentTimestamp,
        };
        canvasData = {
          ...baseCanvasData,
          metadata: runMetadata,
          executionReport,
        };
      } else {
        const designMetadata = {
          ...flowMetadata,
          flowName: baseName,
          lastUpdatedBy: activeUser,
          lastUpdatedAt: currentTimestamp,
        };
        setFlowMetadata(designMetadata);
        canvasData = {
          ...baseCanvasData,
          metadata: designMetadata,
        };
      }

      if (activeMode === WorkspaceMode.Execution) {
        const runFilename = `Run_${baseName}_${Date.now()}.json`;

        const response = await fetch("/api/save-run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canvasData, filename: runFilename }),
        });

        if (!response.ok) {
          throw new Error(
            `Local server rejected the run payload with status: ${response.status}`,
          );
        }

        console.log(
          `[Flowstride Telemetry]: Execution Run securely vaulted as ${runFilename}`,
        );
        toast.success(`Run successfully submitted and vaulted locally.`);
      } else {
        const filename = `${baseName}.json`;

        const response = await fetch("/api/save-design", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canvasData, filename: filename }),
        });

        if (!response.ok) {
          throw new Error(
            `Local server rejected the template payload with status: ${response.status}`,
          );
        }

        const result = await response.json();

        if (oldPhysicalFileToDelete) {
          try {
            await fetch(
              `/api/template?filename=${encodeURIComponent(oldPhysicalFileToDelete)}`,
              {
                method: "DELETE",
              },
            );
            console.log(
              `[Flowstride Telemetry]: Old physical file ${oldPhysicalFileToDelete} securely wiped after rename.`,
            );
          } catch (deleteError) {
            console.error(
              "[Flowstride Telemetry Error]: Failed to wipe old file during rename",
              deleteError,
            );
          }
        }

        console.log(
          `[Flowstride Telemetry]: Design securely vaulted locally as ${filename}`,
        );

        if (activeFlowId && activeFlowId.startsWith("unsaved-temp")) {
          setFlows((prev) => prev.filter((f) => f.id !== activeFlowId));
        }

        await fetchTemplates();

        if (result.filename) {
          setActiveFlowId(result.filename);
        }

        toast.success(`Successfully vaulted ${baseName} locally`);
      }
    } catch (error: any) {
      console.error(
        "[Flowstride Telemetry Error]: Failed to vault data locally:",
        error.message,
      );
      toast.error("Failed to vault data securely.");
      throw error;
    }
  };

  const handleModeChange = async (mode: WorkspaceMode) => {
    if (
      mode === WorkspaceMode.Execution &&
      activeMode === WorkspaceMode.Design
    ) {
      try {
        await handleSaveWorkspace();
      } catch (error) {
        console.warn(
          "[Flowstride Telemetry Error]: Aborting mode switch due to auto save failure.",
        );
        return;
      }
    }
    setActiveMode(mode);
  };

  const handleExecutionReportChange = useCallback(
    (newReport: ExecutionReportStep[]) => {
      if (!activeHistoricalRunId) {
        setExecutionReport(newReport);
      }
    },
    [activeHistoricalRunId],
  );

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#ffffff",
        color: "#24292f",
        height: "100%",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            fontSize: "14px",
            fontWeight: "500",
            color: "#57606a",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            padding: "12px 16px",
          },
          success: {
            style: {
              background: "#ebfdf0",
              border: "1px solid #bceabf",
            },
            iconTheme: {
              primary: "#34c759",
              secondary: "#ffffff",
            },
          },
          error: {
            style: {
              background: "#ffebe9",
              border: "1px solid #ff8182",
            },
            iconTheme: {
              primary: "#cf222e",
              secondary: "#ffffff",
            },
          },
        }}
      />

      <TopToolbar
        activeMode={activeMode}
        onModeChange={handleModeChange}
        onSave={handleSaveWorkspace}
        flows={flows}
        activeFlowId={activeFlowId}
        onSelectFlow={handleSelectFlow}
        onCreateFlow={handleCreateFlow}
        onDeleteFlow={handleDeleteFlow}
        onRenameFlow={handleRenameFlow}
        zoomLevel={zoomLevel}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        metadata={flowMetadata}
        onMetadataChange={setFlowMetadata}
      />

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {activeMode === WorkspaceMode.Design && (
          <ToolPalette activeTool={activeTool} onToolSelect={setActiveTool} />
        )}

        <FlowCanvas
          key={
            activeHistoricalRunId
              ? `historical-run-${activeHistoricalRunId}`
              : "persistent-design-canvas"
          }
          ref={canvasRef as any}
          activeMode={activeMode}
          activeTool={activeTool}
          onNodeSelected={(
            id,
            title,
            desc,
            visualStep,
            stepsContent,
            expectedResult,
            references,
            priority,
          ) =>
            handleEntitySelected(
              id,
              title,
              desc,
              "Node",
              visualStep,
              stepsContent,
              expectedResult,
              references,
              priority,
            )
          }
          nodeUpdateTrigger={
            selectedEntity?.type === "Node"
              ? {
                  stepNumber: selectedEntity.id,
                  title: selectedEntity.title,
                  description: selectedEntity.description,
                  stepsContent: selectedEntity.stepsContent || "",
                  expectedResult: selectedEntity.expectedResult || "",
                  references: selectedEntity.references || "",
                  priority: selectedEntity.priority || "",
                }
              : null
          }
          defectUpdateTrigger={defectTrigger}
          onGroupSelected={(id, title) =>
            handleEntitySelected(id, title, "", "Group")
          }
          groupUpdateTrigger={
            selectedEntity?.type === "Group"
              ? { groupId: selectedEntity.id, title: selectedEntity.title }
              : null
          }
          onTextSelected={(id, content) =>
            handleEntitySelected(id, content, "", "Text")
          }
          textUpdateTrigger={
            selectedEntity?.type === "Text"
              ? { textId: selectedEntity.id, content: selectedEntity.title }
              : null
          }
          onExecutionReportChange={handleExecutionReportChange}
          zoomLevel={zoomLevel}
          recenterTrigger={recenterTrigger}
          onToolChange={setActiveTool}
        />

        {activeMode === WorkspaceMode.Design ? (
          selectedEntity ? (
            <PropertyEditor
              entityType={selectedEntity.type}
              entityId={selectedEntity.id}
              visualStep={selectedEntity.visualStep}
              title={selectedEntity.title}
              description={selectedEntity.description}
              stepsContent={selectedEntity.stepsContent}
              expectedResult={selectedEntity.expectedResult}
              referencesContent={selectedEntity.references}
              priority={selectedEntity.priority}
              onTitleChange={(newTitle) =>
                setSelectedEntity({ ...selectedEntity, title: newTitle })
              }
              onDescriptionChange={(newDescription) =>
                setSelectedEntity({
                  ...selectedEntity,
                  description: newDescription,
                })
              }
              onStepsContentChange={(newSteps) =>
                setSelectedEntity({ ...selectedEntity, stepsContent: newSteps })
              }
              onExpectedResultChange={(newResult) =>
                setSelectedEntity({
                  ...selectedEntity,
                  expectedResult: newResult,
                })
              }
              onReferencesChange={(newRefs) =>
                setSelectedEntity({ ...selectedEntity, references: newRefs })
              }
              onPriorityChange={(newPriority) =>
                setSelectedEntity({ ...selectedEntity, priority: newPriority })
              }
            />
          ) : (
            <aside
              style={{
                width: "320px",
                backgroundColor: "#ffffff",
                borderLeft: "1px solid #e1e4e8",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontSize: "13px",
                  color: "#8c959f",
                  fontWeight: "500",
                }}
              >
                Select an entity on the canvas to view properties
              </span>
            </aside>
          )
        ) : (
          <TestReportPanel
            report={executionReport}
            onDefectSubmit={handleDefectSubmit}
            isReadOnly={!!activeHistoricalRunId}
          />
        )}
      </div>
    </div>
  );
};
